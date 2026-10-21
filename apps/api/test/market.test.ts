import { test } from "node:test";
import assert from "node:assert/strict";
import { marketFixture } from "./market-fixture.js";

test("on-demand quotes, shared caching and valuation authorization", async (suite) => {
  const f = await marketFixture(suite);
  let assetA = "",
    assetB = "",
    account = "",
    bank = "";
  try {
    await suite.test(
      "saving an asset does not start polling, fetch a price or create price rows",
      async () => {
        assetA = (await f.create("assets", { instrumentId: f.ids[0] })).id;
        assetB = (
          await f.create("assets", { instrumentId: f.ids[0] }, f.cookies[1])
        ).id;
        assert.equal(f.calls(), 0);
        assert.equal((await f.request("assets")).body.length, 1);
        assert.equal(
          (await f.request("assets", undefined, f.cookies[1])).body[0].id,
          assetB,
        );
      },
    );
    await suite.test(
      "first view awaits a quote and simultaneous users share a single request",
      async () => {
        const [a, b] = await Promise.all([
          f.request("assets/prices"),
          f.request("assets/prices", undefined, f.cookies[1]),
        ]);
        assert.equal(a.body[0].assetId, assetA);
        assert.equal(b.body[0].assetId, assetB);
        assert.equal(a.body[0].quote.price, "123.45");
        assert.equal(a.body[0].quote.kind, "QUOTE");
        assert.equal(a.body[0].quote.delayMinutes, 15);
        assert.equal(f.calls(), 1);
      },
    );
    await suite.test(
      "a warm quote is reused without renewal or persistence",
      async () => {
        await f.request("assets/prices");
        await f.request("assets/prices", undefined, f.cookies[1]);
        assert.equal(f.calls(), 1);
        assert.equal(await f.db.instrumentDirectoryCache.count(), 0);
      },
    );
    await suite.test(
      "cache expiry fetches the changed price and preserves precise amounts",
      async () => {
        f.advance(60_001);
        f.setPrice("123.45000001");
        const result = await f.request("assets/prices");
        assert.equal(result.body[0].quote.price, "123.45000001");
        assert.equal(f.calls(), 2);
        f.advance(60_001);
        f.setPrice("123.45");
        await f.request("assets/prices");
      },
    );
    await suite.test(
      "portfolio and dashboard values use current quotes and include acquisition fees",
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
            name: "Portfolio",
            type: "INVESTMENT",
            currency: "EUR",
            initialBalance: "0",
          })
        ).id;
        await f.create("investments", {
          accountId: account,
          sourceAccountId: bank,
          assetId: assetA,
          type: "BUY",
          quantity: "2",
          pricePerUnit: "100",
          totalAmount: "200",
          fee: "50",
          currency: "EUR",
          executedAt: new Date().toISOString(),
        });
        const result = await f.request("accounts/" + account + "/portfolio");
        assert.equal(result.body.positions[0].marketValue, "246.9");
        assert.equal(result.body.positions[0].costBasis, "250");
        assert.equal(result.body.positions[0].unrealizedGain, "-3.1");
        assert.equal(result.body.totalValue, "246.9");
        const overview = await f.request("overview?currency=EUR");
        assert.equal(overview.body.investments, "246.9");
      },
    );
    await suite.test(
      "foreign account access and unauthenticated price reads fail",
      async () => {
        assert.equal(
          (
            await f.request(
              "accounts/" + account + "/portfolio",
              undefined,
              f.cookies[1],
            )
          ).status,
          404,
        );
        assert.equal(
          (await f.request("assets/prices", undefined, "")).status,
          401,
        );
        assert.equal(
          (await f.request("instruments/directory", undefined, "")).status,
          401,
        );
        assert.equal(
          (
            await f.request("assets", {
              instrumentId: f.ids[0],
              userId: f.users[1],
            })
          ).status,
          400,
        );
      },
    );
    await suite.test(
      "transient errors retain the original quote time with a stale flag",
      async () => {
        const before = (await f.request("assets/prices")).body[0].quote;
        f.advance(60_001);
        f.fail("MARKET_RATE_LIMIT");
        const result = (await f.request("assets/prices")).body[0];
        assert.equal(result.error, "MARKET_RATE_LIMIT");
        assert.equal(result.quote.stale, true);
        assert.equal(result.quote.price, before.price);
        assert.equal(result.quote.marketAt, before.marketAt);
        assert.equal(result.quote.fetchedAt, before.fetchedAt);
        const calls = f.calls();
        await f.request("assets/prices", undefined, f.cookies[1]);
        assert.equal(f.calls(), calls);
      },
    );
    await suite.test(
      "a later successful request clears stale status and updates P/L",
      async () => {
        f.advance(60_001);
        f.setPrice("150");
        const result = await f.request("accounts/" + account + "/portfolio");
        assert.equal(result.body.quotes[0].quote.stale, false);
        assert.equal(result.body.positions[0].unrealizedGain, "50");
        assert.equal(result.body.totalValue, "300");
        assert.equal(
          (
            await f.db.investmentTransaction.findFirstOrThrow({
              where: { userId: f.users[0] },
            })
          ).totalAmount.toString(),
          "200",
        );
      },
    );
    await suite.test(
      "identity failures do not silently reuse a cached price",
      async () => {
        f.advance(60_001);
        f.fail("MARKET_IDENTITY_MISMATCH");
        const result = await f.request("accounts/" + account + "/portfolio");
        assert.equal(result.body.quotes[0].quote, null);
        assert.equal(result.body.quotes[0].error, "MARKET_IDENTITY_MISMATCH");
        assert.equal(result.body.totalValue, null);
        assert.equal(result.body.positions[0].costBasis, "250");
      },
    );
    await suite.test(
      "missing prices are unavailable, never zero or an endless pending state",
      async () => {
        f.advance(60_001);
        f.fail("MARKET_SYMBOL_NOT_FOUND");
        const result = (await f.request("assets/prices")).body[0];
        assert.equal(result.quote, null);
        assert.equal(result.error, "MARKET_SYMBOL_NOT_FOUND");
      },
    );
    await suite.test(
      "disabled market data does not issue requests",
      async () => {
        process.env.MARKET_DATA_ENABLED = "false";
        const calls = f.calls();
        assert.equal(
          (await f.request("assets/prices")).body[0].error,
          "MARKET_NOT_CONFIGURED",
        );
        assert.equal(f.calls(), calls);
        process.env.MARKET_DATA_ENABLED = "true";
      },
    );
    await suite.test(
      "background polling does not prolong idle authentication sessions",
      async () => {
        await f.db.session.updateMany({
          where: { userId: f.users[0] },
          data: { lastSeenAt: new Date(Date.now() - 6 * 60_000) },
        });
        const before = await f.db.session.findFirstOrThrow({
          where: { userId: f.users[0] },
        });
        await f.request(
          "assets/prices",
          undefined,
          f.cookies[0],
          undefined,
          true,
        );
        const after = await f.db.session.findFirstOrThrow({
          where: { id: before.id },
        });
        assert.equal(
          after.lastSeenAt.toISOString(),
          before.lastSeenAt.toISOString(),
        );
      },
    );
    await suite.test(
      "retired refresh and historical endpoints cannot create background jobs",
      async () => {
        assert.equal(
          (await f.request("assets/" + assetA + "/refresh", {})).status,
          404,
        );
        assert.equal(
          (
            await f.request(
              "accounts/" + account + "/portfolio?asOf=2026-01-01",
            )
          ).status,
          400,
        );
      },
    );
  } finally {
    await f.close();
  }
});
