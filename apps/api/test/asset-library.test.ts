import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.ALPHA_VANTAGE_API_KEY = "fixture-not-a-real-key";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Dedicated test database required");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { InstrumentsService, InstrumentProvider, MarketPriceSync } =
  await import("../src/instruments.js");

test("private asset library and initial provider quotes", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const external = app.get(InstrumentProvider),
    instruments = app.get(InstrumentsService);
  const users: string[] = [],
    cookies: string[] = [],
    assets: string[] = [],
    instrumentIds: string[] = [];
  const symbol = `LIB${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const request = async (
    path: string,
    body?: unknown,
    token = cookies[0],
    background = false,
    method = "POST",
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        Cookie: token ?? "",
        Origin: "http://localhost:3000",
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
        ...(background ? { "X-Opulya-Poll": "1" } : {}),
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(
              path === "auth/signup" ? signupRequestBody(body) : body,
            ),
    });
    if (path === "auth/signup" && response.status === 201)
      return completeTestSignup(app, url, body);
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const snapshot = {
    price: "123.00000001",
    currency: "USD",
    kind: "QUOTE" as const,
    marketAt: new Date(Date.now() - 5000),
    tradingDate: new Date(new Date().toISOString().slice(0, 10)),
    availableAt: new Date(Date.now() - 5000),
    fetchedAt: new Date(),
    provider: "Alpha Vantage",
  };
  let calls = 0;
  external.current = async () => {
    calls++;
    return snapshot;
  };
  // Only this suite's tenants are eligible; never contact an external provider or refresh other fixtures.
  const syncDb = {
    marketJob: db.marketJob,
    instrumentMapping: db.instrumentMapping,
    latestPrice: db.latestPrice,
    marketQuota: db.marketQuota,
    $transaction: db.$transaction.bind(db),
    asset: {
      findMany: (args: Parameters<typeof db.asset.findMany>[0]) =>
        db.asset.findMany({
          ...args,
          where: { AND: [args?.where ?? {}, { userId: { in: users } }] },
        }),
    },
    investmentTransaction: {
      findMany: () =>
        db.investmentTransaction.findMany({
          where: {
            userId: { in: users },
            voidedAt: null,
            type: { in: ["BUY", "SELL"] },
          },
          select: {
            accountId: true,
            assetId: true,
            type: true,
            quantity: true,
          },
        }),
    },
  } as unknown as InstanceType<typeof Database>;
  const sync = new MarketPriceSync(syncDb, instruments, external);
  try {
    for (let i = 0; i < 2; i++) {
      const user = await request(
        "auth/signup",
        {
          firstName: "Asset",
          lastName: "Test",
          email: `library-${randomUUID()}@example.test`,
          password: "asset-library-test-123",
        },
        "",
      );
      assert.equal(user.status, 201);
      users.push(user.body.id);
      cookies.push(user.cookie!);
    }
    const item = await instruments.remember({
      symbol,
      name: "Provider asset",
      assetType: "STOCK",
      currency: "USD",
      exchange: "NASDAQ",
      mic: "XNAS",
      timeZone: "America/New_York",
      isin: null,
    });
    instrumentIds.push(item.id);
    const unused = await instruments.remember({
      symbol: `${symbol}X`,
      name: "Unused catalogue item",
      assetType: "ETF",
      currency: "USD",
      exchange: "NYSE",
      mic: "XNYS",
      timeZone: "America/New_York",
      isin: null,
    });
    instrumentIds.push(unused.id);
    await suite.test(
      "asset selection saves a private reference and a durable first-quote request",
      async () => {
        for (let i = 0; i < 2; i++) {
          const selected = await request(
            "assets",
            { instrumentId: item.id },
            cookies[i],
          );
          assert.equal(selected.status, 201);
          assets.push(selected.body.id);
        }
        assert.notEqual(assets[0], assets[1]);
        assert.ok(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: item.id },
            })
          ).currentRequestedAt,
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { userId: { in: users } },
          }),
          0,
        );
        assert.equal(
          (await request("assets/prices")).body[0].error,
          "MARKET_PRICE_PENDING",
        );
      },
    );
    await suite.test(
      "fetches the initial quote without holdings and shares one cache across users",
      async () => {
        assert.equal((await sync.run()).updated, 1);
        assert.equal(calls, 1);
        const price = await db.latestPrice.findUniqueOrThrow({
          where: { instrumentId: item.id },
        });
        assert.equal(price.kind, "QUOTE");
        assert.equal(price.price.toFixed(), snapshot.price);
        assert.equal(
          price.marketAt!.toISOString(),
          snapshot.marketAt.toISOString(),
        );
        assert.equal(
          price.fetchedAt.toISOString(),
          snapshot.fetchedAt.toISOString(),
        );
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId: unused.id } }),
          0,
        );
        assert.equal(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: item.id },
            })
          ).currentRequestedAt,
          null,
        );
        for (let i = 0; i < 2; i++) {
          const list = await request("assets", undefined, cookies[i]);
          assert.equal(list.body.length, 1);
          assert.equal(list.body[0].id, assets[i]);
          const prices = await request("assets/prices", undefined, cookies[i]);
          assert.equal(prices.body.length, 1);
          assert.equal(prices.body[0].assetId, assets[i]);
          assert.equal(prices.body[0].quote.price, snapshot.price);
        }
      },
    );
    await suite.test(
      "reuses an existing user asset and a fresh quote rather than multiplying requests",
      async () => {
        const selected = await request("assets", { instrumentId: item.id });
        assert.equal(selected.body.id, assets[0]);
        assert.equal((await sync.run()).updated, 0);
        assert.equal(calls, 1);
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId: item.id } }),
          1,
        );
      },
    );
    await suite.test(
      "another user's automatic add reuses an older quote and a daily close without another provider call",
      async () => {
        await db.asset.deleteMany({ where: { userId: users[1] } });
        const earlier = new Date(Date.now() - 5 * 60000);
        await db.latestPrice.update({
          where: { instrumentId: item.id },
          data: { fetchedAt: earlier },
        });
        let added = await request(
          "assets",
          { instrumentId: item.id },
          cookies[1],
        );
        assert.equal(added.status, 201);
        assert.equal((await sync.run()).updated, 0);
        assert.equal(calls, 1);
        assert.equal(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: item.id },
            })
          ).currentRequestedAt,
          null,
        );
        await db.asset.deleteMany({ where: { userId: users[1] } });
        await db.latestPrice.update({
          where: { instrumentId: item.id },
          data: { kind: "CLOSE", marketAt: null },
        });
        added = await request("assets", { instrumentId: item.id }, cookies[1]);
        assert.equal(added.status, 201);
        assert.equal((await sync.run()).updated, 0);
        assert.equal(calls, 1);
        assert.equal(
          (await request("assets/prices", undefined, cookies[1])).body[0].quote
            .price,
          snapshot.price,
        );
        await db.latestPrice.update({
          where: { instrumentId: item.id },
          data: {
            kind: "QUOTE",
            marketAt: snapshot.marketAt,
            fetchedAt: snapshot.fetchedAt,
          },
        });
        assets[1] = added.body.id;
      },
    );
    await suite.test(
      "retired refresh endpoint rejects all callers without queuing a price request",
      async () => {
        assert.equal(
          (await request(`assets/${assets[0]}/price`, {}, cookies[1])).status,
          404,
        );
        assert.equal(
          (await request(`assets/${assets[0]}/price`, {}, "")).status,
          404,
        );
        assert.equal(
          (await request("assets/prices", undefined, "")).status,
          401,
        );
        assert.equal(
          (
            await request(`assets/${assets[0]}/price`, {
              price: "999",
              userId: users[1],
            })
          ).status,
          404,
        );
        assert.equal(
          (await request(`assets/${assets[0]}/price`, {})).status,
          404,
        );
        assert.equal(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: item.id },
            })
          ).currentRequestedAt,
          null,
        );
        assert.equal(calls, 1);
      },
    );
    await suite.test(
      "background price-list polls do not renew sessions and expired sessions fail",
      async () => {
        const seen = new Date(Date.now() - 60_000);
        await db.session.updateMany({
          where: { userId: users[1] },
          data: { lastSeenAt: seen },
        });
        assert.equal(
          (await request("assets/prices", undefined, cookies[1], true)).status,
          200,
        );
        assert.equal(
          (
            await db.session.findFirstOrThrow({ where: { userId: users[1] } })
          ).lastSeenAt.toISOString(),
          seen.toISOString(),
        );
        await db.session.updateMany({
          where: { userId: users[1] },
          data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) },
        });
        assert.equal(
          (await request("assets/prices", undefined, cookies[1], true)).status,
          401,
        );
      },
    );
    await suite.test(
      "a daily close cannot replace a newer quote with an older trading date",
      async () => {
        await db.instrumentMapping.updateMany({
          where: { instrumentId: item.id },
          data: { lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) },
        });
        const yesterday = new Date(snapshot.tradingDate.getTime() - 86400000);
        external.close = async () => ({
          ...snapshot,
          kind: "CLOSE",
          marketAt: null,
          tradingDate: yesterday,
          availableAt: yesterday,
          price: "100",
        });
        await sync.run();
        assert.equal(
          (
            await db.latestPrice.findUniqueOrThrow({
              where: { instrumentId: item.id },
            })
          ).price.toFixed(),
          snapshot.price,
        );
      },
    );
    await suite.test(
      "provider errors retain the cached price and failed requests back off",
      async () => {
        await db.instrumentMapping.updateMany({
          where: { instrumentId: item.id },
          data: {
            currentRequestedAt: new Date(),
            lastAttemptAt: new Date(0),
            error: null,
          },
        });
        external.current = async () => {
          calls++;
          throw new Error("MARKET_ACCESS_DENIED");
        };
        assert.equal((await sync.run()).updated, 0);
        const value = (await request("assets/prices")).body[0];
        assert.equal(value.quote.price, snapshot.price);
        assert.equal(value.quote.stale, true);
        assert.equal(value.error, "MARKET_ACCESS_DENIED");
        assert.equal((await sync.run()).updated, 0);
        assert.equal(calls, 2);
      },
    );
    await suite.test(
      "deletes only owned unused assets without deleting shared market prices",
      async () => {
        const other = await db.user.findUniqueOrThrow({
          where: { id: users[1] },
          select: { email: true },
        });
        const login = await request("auth/login", {
          email: other.email,
          password: "asset-library-test-123",
        });
        assert.equal(login.status, 201);
        cookies[1] = login.cookie!;
        const owned = (await request("assets")).body.find(
          (row: { id: string }) => row.id === assets[0],
        );
        assert.equal(owned.canDelete, true);
        assert.equal(owned.priceConnected, true);
        assert.equal(owned._count, undefined);
        assert.equal(
          (await request(`assets/${assets[0]}`, {}, "", false, "DELETE"))
            .status,
          401,
        );
        assert.equal(
          (
            await request(
              `assets/${assets[0]}`,
              {},
              cookies[1],
              false,
              "DELETE",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `assets/${assets[0]}`,
              { userId: users[0] },
              cookies[0],
              false,
              "DELETE",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `assets/${assets[1]}`,
              {},
              cookies[1],
              false,
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId: item.id } }),
          1,
        );
        assert.equal(await db.asset.count({ where: { id: assets[0] } }), 1);
      },
    );
    await suite.test(
      "investment history, including voided activity, prevents asset deletion",
      async () => {
        const account = await request("accounts", {
          name: "History",
          type: "INVESTMENT",
          currency: "USD",
          initialBalance: "100",
        });
        assert.equal(account.status, 201);
        const entry = await request("investments", {
          accountId: account.body.id,
          assetId: assets[0],
          type: "DIVIDEND",
          totalAmount: "10",
          currency: "USD",
          executedAt: new Date().toISOString(),
          clientRequestId: randomUUID(),
        });
        assert.equal(entry.status, 201);
        assert.equal(
          (
            await request(
              `assets/${assets[0]}`,
              {},
              cookies[0],
              false,
              "DELETE",
            )
          ).status,
          409,
        );
        assert.equal(
          (await request(`investments/${entry.body.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (
            await request(
              `assets/${assets[0]}`,
              {},
              cookies[0],
              false,
              "DELETE",
            )
          ).status,
          409,
        );
        assert.equal(
          (await request("assets")).body.find(
            (row: { id: string }) => row.id === assets[0],
          ).canDelete,
          false,
        );
      },
    );
    await suite.test(
      "serializes asset deletion against concurrent investment activity",
      async () => {
        const selected = await request("assets", { instrumentId: unused.id });
        const account = await request("accounts", {
          name: "Concurrent",
          type: "INVESTMENT",
          currency: "USD",
          initialBalance: "0",
        });
        assert.equal(selected.status, 201);
        assert.equal(account.status, 201);
        const [removed, entry] = await Promise.all([
          request(
            `assets/${selected.body.id}`,
            {},
            cookies[0],
            false,
            "DELETE",
          ),
          request("investments", {
            accountId: account.body.id,
            assetId: selected.body.id,
            type: "DIVIDEND",
            totalAmount: "1",
            currency: "USD",
            executedAt: new Date().toISOString(),
            clientRequestId: randomUUID(),
          }),
        ]);
        assert.ok(
          (removed.status === 200 && entry.status === 404) ||
            (removed.status === 409 && entry.status === 201),
          JSON.stringify([removed, entry]),
        );
      },
    );
  } finally {
    await db.investmentTransaction.deleteMany({
      where: { userId: { in: users } },
    });
    await db.transaction.deleteMany({ where: { userId: { in: users } } });
    await db.account.deleteMany({ where: { userId: { in: users } } });
    await db.asset.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    await app.close();
  }
});
