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
const { InstrumentProvider } = await import("../src/instruments.js");
const { directoryTypes, referenceCacheId } =
  await import("../src/reference-cache.js");

test("Alpha Vantage reference directory and selected-instrument persistence", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const external = app.get(InstrumentProvider);
  const cacheIds = directoryTypes.map(referenceCacheId);
  await db.instrumentDirectoryCache.deleteMany({
    where: { id: { in: cacheIds } },
  });
  const users: string[] = [],
    cookies: string[] = [],
    ids: string[] = [];
  const prefix = `DIR${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const common = {
    name: `Directory fixture ${prefix}`,
    currency: "USD" as const,
    exchange: "United States",
    mic_code: "",
    exchange_timezone: "America/New_York",
  };
  let searches = 0;
  external.references = async (type) =>
    type === "CRYPTO"
      ? [
          {
            symbol: `${prefix}COIN/USD`,
            currency_base: `Coin ${prefix}`,
            available_exchanges: ["Alpha Vantage"],
          },
        ]
      : [
          {
            ...common,
            symbol: `${prefix}${type}`,
            type:
              type === "STOCK"
                ? "Common Stock"
                : type === "FUND"
                  ? "Mutual Fund"
                  : "ETF",
          },
        ];
  external.search = async (symbol, assetType, currency) => {
    searches++;
    return [
      {
        symbol,
        name: common.name,
        assetType: assetType!,
        currency: currency!,
        exchange: "United States",
        mic: "",
        timeZone: "America/New_York",
        isin: null,
      },
    ];
  };
  const request = async (
    path: string,
    body?: unknown,
    cookie = cookies[0],
    method?: string,
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Cookie: cookie ?? "",
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
  try {
    for (let i = 0; i < 2; i++) {
      const signup = await request(
        "auth/signup",
        {
          firstName: "Directory",
          lastName: "Test",
          email: `directory-${randomUUID()}@example.test`,
          password: "directory-test-password-123",
        },
        "",
      );
      assert.equal(signup.status, 201);
      users.push(signup.body.id);
      cookies.push(signup.cookie!);
    }
    let choices: { id: string; assetType: string }[] = [];
    await suite.test(
      "authenticated browse includes US stocks, ETFs and crypto without saving or pricing unused references",
      async () => {
        let result = await request(
          `instruments/directory?currency=USD&search=${prefix}`,
        );
        for (
          let i = 0;
          i < 50 && (result.body.loading.length || result.body.items.length < 3);
          i++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          result = await request(
            `instruments/directory?currency=USD&search=${prefix}`,
          );
        }
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.loading, []);
        assert.deepEqual(result.body.errors, []);
        choices = result.body.items;
        assert.equal(choices.length, 3);
        assert.deepEqual(
          new Set(choices.map((row) => row.assetType)),
          new Set(["STOCK", "ETF", "CRYPTO"]),
        );
        assert.equal(
          await db.instrument.count({
            where: { symbol: { startsWith: prefix } },
          }),
          0,
        );
        assert.equal(
          await db.asset.count({ where: { userId: { in: users } } }),
          0,
        );
        assert.equal(searches, 0);
      },
    );
    let owned = "";
    await suite.test(
      "a restarted API restores available reference feeds without downloading feeds again",
      async () => {
        const restarted = await bootstrap(0);
        const provider = restarted.get(InstrumentProvider);
        let downloads = 0;
        provider.references = async () => {
          downloads++;
          throw new Error("Unexpected provider call");
        };
        try {
          const base = await restarted.getUrl();
          const cookie = cookies[0];
          assert.ok(cookie);
          let body;
          for (let i = 0; i < 50; i++) {
            const response: Response = await fetch(
              `${base}/api/instruments/directory?currency=USD&search=${prefix}`,
              { headers: { Cookie: cookie } },
            );
            assert.equal(response.status, 200);
            body = await response.json();
            if (!body.loading.length) break;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          assert.equal(body.total, 3);
          assert.deepEqual(body.errors, []);
          assert.equal(downloads, 0);
          assert.equal(
            await db.instrumentDirectoryCache.count({
              where: { id: { in: cacheIds } },
            }),
            3,
          );
        } finally {
          await restarted.close();
        }
      },
    );
    await suite.test(
      "selecting a referenced ETF queues its first price without another billed lookup",
      async () => {
        const selected = await request("assets", {
          instrumentId: choices.find((row) => row.assetType === "ETF")!.id,
        });
        assert.equal(selected.status, 201);
        owned = selected.body.id;
        ids.push(selected.body.instrumentId);
        const item = await db.instrument.findUniqueOrThrow({
          where: { id: ids[0] },
        });
        assert.equal(item.assetType, "ETF");
        assert.equal(item.mic, "");
        assert.equal(item.timeZone, "America/New_York");
        assert.equal(searches, 0);
        assert.equal(
          await db.instrument.count({
            where: { symbol: { startsWith: prefix } },
          }),
          1,
        );
        assert.ok(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: item.id },
            })
          ).currentRequestedAt,
        );
        assert.equal(
          await db.latestPrice.count({ where: { instrumentId: item.id } }),
          0,
        );
      },
    );
    await suite.test(
      "hides only the logged-in user's assets without leaking shared-cache ownership",
      async () => {
        const path = `instruments/directory?currency=USD&search=${prefix}&assetType=ETF`;
        const own = await request(path);
        assert.equal(own.body.total, 0);
        assert.equal(own.body.ownedCount, 1);
        assert.equal(own.body.hasMore, false);
        const other = await request(path, undefined, cookies[1]);
        assert.equal(other.body.total, 1);
        assert.equal(other.body.ownedCount, 0);
        assert.equal((await request(`${path}&mode=match`)).status, 400);
        assert.equal(
          (
            await request("instruments/search", {
              search: `${prefix}ETF`,
              currency: "USD",
              assetType: "ETF",
            })
          ).body.length,
          0,
        );
        assert.equal(searches, 0);
        const repeat = await request("assets", { instrumentId: ids[0] });
        assert.equal(repeat.body.id, owned);
        assert.equal(await db.asset.count({ where: { userId: users[0] } }), 1);
      },
    );
    await suite.test(
      "rejects foreign remapping before any provider lookup",
      async () => {
        const result = await request(
          `assets/${owned}/instrument`,
          {
            instrumentId: choices.find((row) => row.assetType === "STOCK")!.id,
          },
          cookies[1],
          "PATCH",
        );
        assert.equal(result.status, 404);
        assert.equal(searches, 0);
        assert.equal(
          await db.instrument.count({
            where: { symbol: { startsWith: prefix } },
          }),
          1,
        );
      },
    );
    await suite.test(
      "rejects forged references, anonymous browsing and malformed queries",
      async () => {
        assert.equal(
          (
            await request("assets", {
              instrumentId: `av:ETF:EUR:${"f".repeat(48)}`,
            })
          ).status,
          404,
        );
        assert.equal(
          (await request("instruments/directory", undefined, "")).status,
          401,
        );
        for (const query of [
          "currency=GBX",
          "page=-1",
          "page=0.5",
          "assetType=OTHER",
          "userId=injected",
        ])
          assert.equal(
            (await request(`instruments/directory?${query}`)).status,
            400,
          );
        assert.equal(
          (await request(`instruments/directory?currency=EUR&search=${prefix}`))
            .body.total,
          0,
        );
      },
    );
  } finally {
    await db.asset.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await db.instrumentDirectoryCache.deleteMany({
      where: { id: { in: cacheIds } },
    });
    await db.marketJob.deleteMany({ where: { id: { in: cacheIds } } });
    await app.close();
  }
});
