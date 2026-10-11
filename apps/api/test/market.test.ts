import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ProviderPrice } from "../src/alpha-vantage.js";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.ALPHA_VANTAGE_API_KEY = "fixture-not-a-real-key";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Market integration tests require opulya_test");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const {
  MarketPriceSync,
  InstrumentProvider,
  InstrumentsService,
  MarketBudget,
} = await import("../src/instruments.js");
const { AppModule } = await import("../src/main.js");

test("replaceable latest prices and instrument ownership", async (suite) => {
  const app = await bootstrap(0);
  const db = app.get(Database);
  const external = app.get(InstrumentProvider);
  const instruments = app.get(InstrumentsService);
  const url = await app.getUrl();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const users: string[] = [],
    instrumentIds: string[] = [];
  const cookies: string[] = [],
    assets: string[] = [],
    accounts: string[] = [];
  const request = async (
    path: string,
    body?: unknown,
    cookie = cookies[0] ?? "",
    method = "POST",
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
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
  const close: ProviderPrice = {
    kind: "CLOSE",
    marketAt: null,
    price: "123.45",
    currency: "USD",
    tradingDate: new Date("2026-09-29"),
    availableAt: new Date("2026-09-30T04:00:00Z"),
    fetchedAt: new Date(),
    provider: "Alpha Vantage",
  };
  let instrumentId = "",
    closeCalls = 0,
    searchCalls = 0;
  external.search = async () => {
    searchCalls++;
    return [
      {
        name: "Market fixture",
        symbol: suffix,
        assetType: "STOCK",
        exchange: "NASDAQ",
        mic: "XNAS",
        currency: "USD",
        timeZone: "America/New_York",
        isin: null,
      },
    ];
  };
  external.close = async () => {
    closeCalls++;
    return close;
  };
  // Limit this worker's financial scan to its own test tenants; no other stored fixtures are touched.
  const syncDb = {
    marketJob: db.marketJob,
    asset: {
      findMany: (args: Parameters<typeof db.asset.findMany>[0]) =>
        db.asset.findMany({
          ...args,
          where: {
            AND: [
              args?.where ?? {},
              {
                userId: { in: users },
                assetType: "STOCK",
                symbol: { in: [suffix, `LEG${suffix}`] },
              },
            ],
          },
        }),
    },
    instrumentMapping: db.instrumentMapping,
    latestPrice: db.latestPrice,
    marketQuota: db.marketQuota,
    $transaction: db.$transaction.bind(db),
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
            quantity: true,
            type: true,
          },
        }),
    },
  } as unknown as InstanceType<typeof Database>;
  const sync = new MarketPriceSync(syncDb, instruments, external);
  try {
    await suite.test(
      "authenticates catalogue access and selects server-owned metadata",
      async () => {
        assert.equal((await request("instruments", undefined, "")).status, 401);
        for (let i = 0; i < 2; i++) {
          const user = await request(
            "auth/signup",
            {
              firstName: "Market",
              lastName: "Test",
              email: `market-${suffix}-${i}@example.test`,
              password: "market-test-password-123",
            },
            "",
          );
          assert.equal(user.status, 201);
          users.push(user.body.id);
          cookies.push(user.cookie!);
        }
        const result = await request("instruments/search", { search: suffix });
        assert.equal(result.status, 201);
        assert.equal(result.body.length, 1);
        instrumentId = result.body[0].id;
        instrumentIds.push(instrumentId);
        await request("instruments/search", { search: suffix });
        assert.equal(searchCalls, 1);
        assert.equal(
          (
            await request("instruments/search", {
              search: suffix,
              userId: users[1],
            })
          ).status,
          400,
        );
        for (let i = 0; i < 2; i++) {
          const asset = await request("assets", { instrumentId }, cookies[i]);
          assert.equal(asset.status, 201);
          assert.equal(asset.body.symbol, suffix);
          assets.push(asset.body.id);
        }
        assert.notEqual(assets[0], assets[1]);
        assert.equal(
          (await request("assets", { instrumentId, symbol: "INJECTED" }))
            .status,
          400,
        );
        assert.equal(
          (await request("assets", { instrumentId: "nonexistent" })).status,
          404,
        );
      },
    );
    await suite.test(
      "rejects custom asset bodies and retired match-mode requests without changing assets",
      async () => {
        const before = await db.asset.count({
          where: { userId: { in: users } },
        });
        for (const body of [
          {
            symbol: "CUSTOM",
            name: "Custom stock",
            assetType: "STOCK",
            currency: "USD",
            exchange: "NASDAQ",
          },
          { name: "Custom", amount: "100" },
          { instrumentId, marketDataIdentifier: "CUSTOM" },
          { instrumentId, userId: users[1] },
        ])
          assert.equal((await request("assets", body)).status, 400);
        assert.equal(
          (
            await request("instruments/search", {
              search: suffix,
              mode: "match",
            })
          ).status,
          400,
        );
        assert.equal(
          await db.asset.count({ where: { userId: { in: users } } }),
          before,
        );
      },
    );
    await suite.test(
      "retired remapping endpoint cannot change owned or foreign assets",
      async () => {
        assert.equal(
          (
            await request(
              `assets/${assets[0]}/instrument`,
              { instrumentId },
              cookies[1],
              "PATCH",
            )
          ).status,
          404,
        );
        const eur = await instruments.remember({
          name: "Different currency",
          symbol: `${suffix}EUR`,
          assetType: "STOCK",
          exchange: "XETRA",
          mic: "XETR",
          currency: "EUR",
          timeZone: "Europe/Berlin",
          isin: null,
        });
        instrumentIds.push(eur.id);
        assert.equal(
          (
            await request(
              `assets/${assets[0]}/instrument`,
              { instrumentId: eur.id },
              cookies[0],
              "PATCH",
            )
          ).status,
          404,
        );
        assert.equal(
          (await db.asset.findUniqueOrThrow({ where: { id: assets[0] } }))
            .instrumentId,
          instrumentId,
        );
      },
    );
    await suite.test(
      "application has no starter-asset seeding provider or fabricated investment activity",
      async () => {
        const providers = Reflect.getMetadata("providers", AppModule) as {
          name: string;
        }[];
        assert.equal(
          providers.some((provider) => provider.name === "MarketCatalogue"),
          false,
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { userId: { in: users } },
          }),
          0,
        );
      },
    );
    await suite.test(
      "collapses crypto source listings and reuses an existing private coin asset",
      async () => {
        const symbol = `CR${suffix}/USD`;
        const cryptoIds: string[] = [];
        for (const exchange of ["Kraken", "Binance"]) {
          const row = await instruments.remember({
            name: "Crypto fixture",
            symbol,
            assetType: "CRYPTO",
            currency: "USD",
            exchange,
            mic: "",
            timeZone: "UTC",
            isin: null,
          });
          cryptoIds.push(row.id);
          instrumentIds.push(row.id);
        }
        const catalogue = await request(
          `instruments?search=${encodeURIComponent(symbol)}`,
        );
        assert.equal(catalogue.body.length, 1);
        assert.equal(catalogue.body[0].exchange, "Binance");
        assert.ok(users[0]);
        assert.ok(cryptoIds[0]);
        const existing = await db.asset.create({
          data: {
            userId: users[0],
            name: "My private coin",
            assetType: "CRYPTO",
            symbol,
            currency: "USD",
            exchange: "Kraken",
            instrumentId: cryptoIds[0],
          },
        });
        const selected = await request("assets", {
          instrumentId: cryptoIds[1],
        });
        assert.equal(selected.status, 201);
        assert.equal(selected.body.id, existing.id);
        assert.equal(selected.body.name, "My private coin");
        assert.equal(selected.body.instrumentId, cryptoIds[0]);
        assert.equal(
          await db.asset.count({
            where: { userId: users[0], assetType: "CRYPTO", symbol },
          }),
          1,
        );
        assert.equal(
          (await request("assets", { instrumentId: cryptoIds[1] }, cookies[1]))
            .body.userId,
          users[1],
        );
      },
    );
    await suite.test(
      "keeps the Bitcoin coin separate from Bitcoin-related funds in catalogue and discovery",
      async () => {
        const coin = {
          name: `Bitcoin ${suffix}`,
          symbol: `BC${suffix}/USD`,
          assetType: "CRYPTO" as const,
          currency: "USD",
          exchange: "Binance",
          mic: "",
          timeZone: "UTC",
          isin: null,
        };
        const fund = {
          ...coin,
          name: `CoinShares ${coin.name}`,
          symbol: `ET${suffix}`,
          assetType: "ETF" as const,
          exchange: "NASDAQ",
          mic: "XNAS",
        };
        const cash = {
          ...coin,
          name: `${coin.name} Cash`,
          symbol: `BH${suffix}/USD`,
        };
        for (const input of [coin, fund, cash])
          instrumentIds.push((await instruments.remember(input)).id);
        const path = `instruments?search=${encodeURIComponent(coin.name)}&currency=USD`;
        const crypto = await request(`${path}&assetType=CRYPTO`);
        assert.equal(crypto.body.length, 1);
        assert.equal(crypto.body[0].name, coin.name);
        assert.equal(crypto.body[0].assetType, "CRYPTO");
        const etfs = await request(`${path}&assetType=ETF`);
        assert.equal(etfs.body.length, 1);
        assert.equal(etfs.body[0].assetType, "ETF");
        assert.equal((await request(`${path}&assetType=invalid`)).status, 400);
        const originalSearch = external.search;
        external.search = async () => [coin, fund];
        try {
          const discovered = await request("instruments/search", {
            search: coin.name,
            assetType: "CRYPTO",
            currency: "USD",
          });
          assert.equal(discovered.status, 201);
          assert.equal(discovered.body.length, 1);
          assert.equal(discovered.body[0].assetType, "CRYPTO");
        } finally {
          external.search = originalSearch;
        }
      },
    );
    await suite.test(
      "creates two tenants holding one shared instrument",
      async () => {
        for (let i = 0; i < 2; i++) {
          const bank = await request(
            "accounts",
            {
              name: "Source",
              type: "BANK",
              currency: "USD",
              initialBalance: "1000",
            },
            cookies[i],
          );
          const account = await request(
            "accounts",
            {
              name: "Portfolio",
              type: "INVESTMENT",
              currency: "USD",
              initialBalance: "0",
            },
            cookies[i],
          );
          accounts.push(account.body.id);
          const buy = await request(
            "investments",
            {
              accountId: account.body.id,
              sourceAccountId: bank.body.id,
              assetId: assets[i],
              type: "BUY",
              quantity: "2",
              pricePerUnit: "100",
              totalAmount: "200",
              currency: "USD",
              executedAt: "2026-09-15T12:00:00Z",
              clientRequestId: randomUUID(),
            },
            cookies[i],
          );
          assert.equal(buy.status, 201);
        }
      },
    );
    await suite.test(
      "refreshes once for both tenants and avoids repeated calls",
      async () => {
        // This suite exercises closing-price refresh; first-quote requests have a dedicated suite.
        await db.instrumentMapping.updateMany({
          where: { instrumentId },
          data: { currentRequestedAt: null },
        });
        assert.equal((await sync.run()).updated, 1);
        assert.equal(closeCalls, 1);
        assert.equal((await sync.run()).updated, 0);
        assert.equal(closeCalls, 1);
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId } }),
          1,
        );
        for (let i = 0; i < 2; i++) {
          const value = await request(
            `accounts/${accounts[i]}/portfolio`,
            undefined,
            cookies[i],
          );
          assert.equal(value.body.holdingsValue, "246.9");
          assert.equal(value.body.quotes[0].quote.tradingDate, "2026-09-29");
          assert.equal(value.body.quotes[0].quote.provider, "Alpha Vantage");
        }
        assert.equal(closeCalls, 1);
        assert.equal(
          (
            await request(
              `accounts/${accounts[0]}/portfolio`,
              undefined,
              cookies[1],
            )
          ).status,
          404,
        );
      },
    );
    await suite.test(
      "rejects historical valuation now that only the latest price is stored",
      async () => {
        const before = await request(
          `accounts/${accounts[0]}/portfolio?at=2026-09-29T18%3A00%3A00Z`,
        );
        assert.equal(before.status, 400);
        const after = await request(
          `accounts/${accounts[0]}/portfolio?at=2026-10-01T00%3A00%3A00Z`,
        );
        assert.equal(after.status, 400);
        assert.equal(closeCalls, 1);
      },
    );
    await suite.test(
      "a new trading day replaces the price without retaining historical rows or changing trades",
      async () => {
        const transactionsBefore = await db.investmentTransaction.findMany({
          where: { userId: { in: users } },
          orderBy: { id: "asc" },
        });
        await db.instrumentMapping.updateMany({
          where: { instrumentId },
          data: { lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) },
        });
        external.close = async () => ({
          ...close,
          price: "150",
          tradingDate: new Date("2026-09-30"),
          availableAt: new Date("2026-10-01T04:00:00Z"),
          fetchedAt: new Date(),
        });
        assert.equal((await sync.run()).updated, 1);
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId } }),
          1,
        );
        const saved = await db.latestPrice.findUniqueOrThrow({
          where: { instrumentId },
        });
        assert.equal(saved.price.toString(), "150");
        assert.equal(
          saved.tradingDate.toISOString().slice(0, 10),
          "2026-09-30",
        );
        const value = await request(`accounts/${accounts[0]}/portfolio`);
        assert.equal(value.body.holdingsValue, "300");
        assert.deepEqual(
          await db.investmentTransaction.findMany({
            where: { userId: { in: users } },
            orderBy: { id: "asc" },
          }),
          transactionsBefore,
        );
        await db.instrumentMapping.updateMany({
          where: { instrumentId },
          data: { lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) },
        });
        external.close = async () => close;
        assert.equal((await sync.run()).updated, 0);
        assert.equal(
          (
            await db.latestPrice.findUniqueOrThrow({ where: { instrumentId } })
          ).price.toString(),
          "150",
        );
      },
    );
    await suite.test(
      "retains the previous price and reports safe errors after a failed refresh",
      async () => {
        await db.instrumentMapping.updateMany({
          where: { instrumentId },
          data: { lastSuccessAt: new Date(0), lastAttemptAt: new Date(0) },
        });
        external.close = async () => {
          throw new Error("MARKET_ACCESS_DENIED");
        };
        assert.equal((await sync.run()).updated, 0);
        const result = await request(`accounts/${accounts[0]}/portfolio`);
        assert.equal(result.body.holdingsValue, "300");
        assert.equal(result.body.quotes[0].quote.stale, true);
        assert.equal(result.body.quotes[0].error, "MARKET_ACCESS_DENIED");
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId } }),
          1,
        );
      },
    );
    await suite.test(
      "excludes overlapping workers with a persisted lease",
      async () => {
        await db.marketJob.update({
          where: { id: "latest-prices" },
          data: {
            token: "other-worker",
            leaseUntil: new Date(Date.now() + 60000),
          },
        });
        assert.equal((await sync.run()).skipped, "BUSY");
        await db.marketJob.update({
          where: { id: "latest-prices" },
          data: { leaseUntil: new Date(0), token: null },
        });
      },
    );
    await suite.test(
      "enforces concurrent quota reservations atomically and survives service recreation",
      async () => {
        const keys = [
          `alpha-vantage:minute:${Math.floor(Date.now() / 60000)}`,
          `alpha-vantage:day:${Math.floor(Date.now() / 86400000)}`,
        ];
        await db.marketQuota.deleteMany({ where: { key: { in: keys } } });
        process.env.MARKET_REQUESTS_PER_MINUTE = "1";
        const results = await Promise.allSettled([
          new MarketBudget(db).reserve(),
          new MarketBudget(db).reserve(),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        await assert.rejects(
          () => new MarketBudget(db).reserve(),
          /MARKET_RATE_LIMIT/,
        );
        assert.equal(
          (await db.marketQuota.findUniqueOrThrow({ where: { key: keys[0] } }))
            .count,
          1,
        );
        assert.equal(
          (await db.marketQuota.findUniqueOrThrow({ where: { key: keys[1] } }))
            .count,
          1,
        );
        await db.marketQuota.deleteMany({ where: { key: { in: keys } } });
      },
    );
    await suite.test(
      "links legacy assets without publishing private asset names or rewriting trades",
      async () => {
        const symbol = `LEG${suffix}`;
        const old = await db.instrument.create({
          data: {
            identity: randomUUID(),
            symbol,
            name: "Public provider label",
            assetType: "STOCK",
            exchange: "NASDAQ",
            mic: "XNGS",
            currency: "USD",
            timeZone: "America/New_York",
            mappings: {
              create: {
                provider: "Twelve Data",
                symbol,
                exchange: "NASDAQ",
                mic: "XNGS",
                currency: "USD",
              },
            },
          },
        });
        instrumentIds.push(old.id);
        assert.ok(users[0]);
        const legacy = await db.asset.create({
          data: {
            userId: users[0],
            symbol,
            name: "My private personal label",
            assetType: "STOCK",
            exchange: "NASDAQ",
            currency: "USD",
            instrumentId: old.id,
          },
        });
        const bank = await db.account.findFirstOrThrow({
          where: { userId: users[0], type: "BANK" },
        });
        const buy = await request("investments", {
          accountId: accounts[0],
          sourceAccountId: bank.id,
          assetId: legacy.id,
          type: "BUY",
          quantity: "1",
          pricePerUnit: "100",
          totalAmount: "100",
          currency: "USD",
          executedAt: "2026-09-15T12:00:00Z",
          clientRequestId: randomUUID(),
        });
        assert.equal(buy.status, 201);
        external.matchLegacy = async (source) =>
          source.symbol === symbol && source.mic === "XNGS"
            ? {
                symbol,
                name: "Public provider label",
                assetType: "STOCK",
                exchange: "United States",
                mic: "",
                currency: "USD",
                timeZone: "America/New_York",
                isin: null,
              }
            : null;
        external.current = async () => close;
        external.close = async () => close;
        assert.equal((await sync.run()).updated, 1);
        const saved = await db.asset.findUniqueOrThrow({
          where: { id: legacy.id },
        });
        assert.equal(saved.name, "My private personal label");
        const listing = await db.instrument.findUniqueOrThrow({
          where: { id: saved.instrumentId! },
        });
        instrumentIds.push(listing.id);
        assert.equal(listing.name, "Public provider label");
        assert.notEqual(listing.id, old.id);
        assert.equal(
          (
            await db.instrumentMapping.findUniqueOrThrow({
              where: {
                instrumentId_provider: {
                  instrumentId: listing.id,
                  provider: "Alpha Vantage",
                },
              },
            })
          ).symbol,
          symbol,
        );
        assert.equal(
          (
            await db.investmentTransaction.findUniqueOrThrow({
              where: { id: buy.body.id },
            })
          ).assetId,
          legacy.id,
        );
      },
    );
  } finally {
    await db.investmentTransaction.deleteMany({
      where: { userId: { in: users } },
    });
    await db.transaction.deleteMany({ where: { userId: { in: users } } });
    await db.asset.deleteMany({ where: { userId: { in: users } } });
    await db.account.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    await app.close();
  }
});
