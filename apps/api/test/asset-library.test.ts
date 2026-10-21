import { test } from "node:test";
import assert from "node:assert/strict";
import { marketFixture } from "./market-fixture.js";

test("private asset library without persisted market prices", async (suite) => {
  const f = await marketFixture(suite);
  let asset = "",
    other = "",
    bank = "",
    account = "",
    activity = "";
  try {
    await suite.test(
      "has no starter assets or predefined categories",
      async () => {
        assert.deepEqual((await f.request("assets")).body, []);
        assert.deepEqual((await f.request("categories")).body, []);
        assert.equal(
          (await f.request("instruments/directory")).body.items.length,
          0,
        );
      },
    );
    await suite.test(
      "selects server-owned metadata and reuses an existing private reference",
      async () => {
        asset = (await f.create("assets", { instrumentId: f.ids[1] })).id;
        assert.equal(
          (await f.create("assets", { instrumentId: f.ids[1] })).id,
          asset,
        );
        assert.equal(f.calls(), 0);
        const saved = await f.db.asset.findUniqueOrThrow({
          where: { id: asset },
        });
        assert.equal(saved.userId, f.users[0]);
        assert.equal(saved.instrumentId, f.ids[1]);
        assert.equal(
          (
            await f.request("assets", {
              name: "Forged asset",
              symbol: "FAKE",
              currency: "EUR",
              assetType: "CRYPTO",
            })
          ).status,
          400,
        );
      },
    );
    await suite.test(
      "users share public instruments but cannot access each other's private assets",
      async () => {
        assert.deepEqual(
          (await f.request("assets", undefined, f.cookies[1])).body,
          [],
        );
        other = (
          await f.create("assets", { instrumentId: f.ids[1] }, f.cookies[1])
        ).id;
        assert.notEqual(asset, other);
        assert.equal(
          (await f.request("assets/" + asset, {}, f.cookies[1], "DELETE"))
            .status,
          404,
        );
        assert.equal(
          (await f.request("assets/" + asset, {}, "", "DELETE")).status,
          401,
        );
        const a = await f.request(
          "instruments/directory?search=" + f.prefix + "&assetType=CRYPTO",
        );
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(a.body.ownedCount, 1);
        assert.equal(a.body.items.length, 0);
      },
    );
    await suite.test(
      "opening the library obtains a quote shared by both users",
      async () => {
        const [a, b] = await Promise.all([
          f.request("assets/prices"),
          f.request("assets/prices", undefined, f.cookies[1]),
        ]);
        assert.equal(a.body[0].quote.price, "123.45");
        assert.equal(b.body[0].quote.price, "123.45");
        assert.equal(f.calls(), 1);
      },
    );
    await suite.test(
      "deletes only an unused owned reference, not the public instrument or another user's asset",
      async () => {
        assert.equal(
          (await f.request("assets/" + other, {}, f.cookies[1], "DELETE"))
            .status,
          200,
        );
        assert.ok(
          await f.db.instrument.findUnique({ where: { id: f.ids[1] } }),
        );
        assert.ok(await f.db.asset.findUnique({ where: { id: asset } }));
        other = (
          await f.create("assets", { instrumentId: f.ids[1] }, f.cookies[1])
        ).id;
        await f.request("assets/prices", undefined, f.cookies[1]);
        assert.equal(f.calls(), 1);
      },
    );
    await suite.test(
      "investment history prevents deletion even after activity is voided",
      async () => {
        bank = (
          await f.create("accounts", {
            name: "Bank",
            type: "BANK",
            currency: "EUR",
            initialBalance: "1000",
          })
        ).id;
        account = (
          await f.create("accounts", {
            name: "Investment",
            type: "INVESTMENT",
            currency: "EUR",
            initialBalance: "0",
          })
        ).id;
        activity = (
          await f.create("investments", {
            accountId: account,
            sourceAccountId: bank,
            assetId: asset,
            type: "BUY",
            quantity: "1",
            pricePerUnit: "100",
            totalAmount: "100",
            fee: "0",
            currency: "EUR",
            executedAt: new Date().toISOString(),
          })
        ).id;
        const result = await f.request(
          "assets/" + asset,
          {},
          undefined,
          "DELETE",
        );
        assert.equal(result.status, 409);
        assert.equal(result.body.code, "ASSET_HAS_TRANSACTIONS");
        assert.equal(
          (await f.request("investments/" + activity + "/void", {})).status,
          201,
        );
        assert.equal(
          (await f.request("assets/" + asset, {}, undefined, "DELETE")).status,
          409,
        );
      },
    );
    await suite.test(
      "serializes deletion against concurrent investment activity",
      async () => {
        const candidate = await f.create("assets", { instrumentId: f.ids[0] });
        const [buy, remove] = await Promise.all([
          f.request("investments", {
            accountId: account,
            sourceAccountId: bank,
            assetId: candidate.id,
            type: "BUY",
            quantity: "1",
            pricePerUnit: "100",
            totalAmount: "100",
            fee: "0",
            currency: "EUR",
            executedAt: new Date().toISOString(),
          }),
          f.request("assets/" + candidate.id, {}, undefined, "DELETE"),
        ]);
        if (buy.status === 201) assert.equal(remove.status, 409);
        else {
          assert.equal(remove.status, 200);
          assert.ok([400, 404].includes(buy.status));
        }
      },
    );
    await suite.test(
      "a deleted asset cannot be used as a foreign or nonexistent investment association",
      async () => {
        const result = await f.request("investments", {
          accountId: account,
          sourceAccountId: bank,
          assetId: other,
          type: "BUY",
          quantity: "1",
          pricePerUnit: "100",
          totalAmount: "100",
          fee: "0",
          currency: "EUR",
          executedAt: new Date().toISOString(),
        });
        assert.ok([400, 404].includes(result.status));
      },
    );
  } finally {
    await f.close();
  }
});
