import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.MARKET_DATA_ENABLED = "true";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { InstrumentProvider } = await import("../src/instruments.js");
const { directoryTypes } = await import("../src/yahoo-finance.js");

test("Yahoo catalogue persists only selected, verified listings", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const external = app.get(InstrumentProvider);
  const users: string[] = [],
    cookies: string[] = [],
    ids: string[] = [];
  const prefix = `DIR${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const rows = directoryTypes.map((assetType) => ({
    symbol:
      assetType === "CRYPTO" ? `${prefix}COIN/EUR` : `${prefix}${assetType}.AS`,
    name: `Directory fixture ${prefix}`,
    assetType,
    currency: "EUR",
    exchange: assetType === "CRYPTO" ? "" : "AMS",
    exchangeName: assetType === "CRYPTO" ? null : "Amsterdam",
    mic: assetType === "CRYPTO" ? "" : "XAMS",
    timeZone: "Europe/Amsterdam",
    isin: null,
  }));
  const queries: string[] = [];
  let searches = 0,
    resolutions = 0;
  external.search = async (search, type, currency) => {
    searches++;
    queries.push(search);
    return rows.filter(
      (row) =>
        (!type || row.assetType === type) &&
        (!currency || row.currency === currency),
    );
  };
  external.resolve = async (symbol, currency, type) => {
    resolutions++;
    const row = rows.find(
      (row) =>
        row.symbol.replace("/", "-") === symbol &&
        row.currency === currency &&
        row.assetType === type,
    );
    if (!row) throw new Error("MARKET_IDENTITY_MISMATCH");
    return row;
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
    await suite.test(
      "empty search has no starter assets and makes no external call",
      async () => {
        const result = await request("instruments/directory");
        assert.equal(result.status, 200);
        assert.deepEqual(result.body.items, []);
        assert.equal(searches, 0);
      },
    );
    let choices: { id: string; assetType: string }[] = [];
    await suite.test(
      "search includes European stocks, ETFs, funds and crypto without saving unused instruments",
      async () => {
        const result = await request(
          `instruments/directory?currency=EUR&search=${prefix}`,
        );
        assert.equal(result.status, 200);
        choices = result.body.items;
        assert.deepEqual(
          new Set(choices.map((row) => row.assetType)),
          new Set(directoryTypes),
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
        assert.equal(resolutions, 0);
      },
    );
    let owned = "";
    await suite.test(
      "selection revalidates metadata and shares the verified Yahoo mapping",
      async () => {
        const selected = await request("assets", {
          instrumentId: choices.find((row) => row.assetType === "ETF")!.id,
        });
        assert.equal(selected.status, 201);
        owned = selected.body.id;
        ids.push(selected.body.instrumentId);
        assert.equal(resolutions, 1);
        const instrument = await db.instrument.findUniqueOrThrow({
          where: { id: ids[0] },
        });
        assert.equal(instrument.currency, "EUR");
        assert.equal(instrument.mic, "XAMS");
        assert.equal(instrument.exchangeName, "Amsterdam");
        const assets = await request("assets");
        assert.equal(assets.body[0].exchangeName, "Amsterdam");
        assert.equal(assets.body[0].mic, "XAMS");
        assert.equal(assets.body[0].isin, null);
        assert.equal(
          await db.instrument.count({
            where: { symbol: { startsWith: prefix } },
          }),
          1,
        );
        assert.equal(
          (
            await db.instrumentMapping.findFirstOrThrow({
              where: { instrumentId: instrument.id },
            })
          ).provider,
          "Yahoo Finance",
        );
      },
    );
    await suite.test(
      "ownership filtering is private and another user's asset shares the instrument",
      async () => {
        const path = `instruments/directory?currency=EUR&search=${prefix}&assetType=ETF`;
        const own = await request(path),
          other = await request(path, undefined, cookies[1]);
        assert.equal(own.body.total, 0);
        assert.equal(own.body.ownedCount, 1);
        assert.equal(other.body.total, 1);
        assert.equal(other.body.ownedCount, 0);
        const selected = await request(
          "assets",
          { instrumentId: other.body.items[0].id },
          cookies[1],
        );
        assert.equal(selected.body.instrumentId, ids[0]);
        assert.equal(
          (await request("assets", { instrumentId: ids[0] })).body.id,
          owned,
        );
      },
    );
    await suite.test(
      "free-text searches reach the provider unchanged without asserting ISIN identity",
      async () => {
        for (const search of [
          "World fund",
          "IWDA.AS",
          "BTC/EUR",
          "S&P 500",
          "IE00B4L5Y983",
          "IE00B4L5Y984",
          "LIVE12345678",
        ]) {
          const result = await request(
            `instruments/directory?search=${encodeURIComponent(search)}&currency=EUR`,
          );
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(queries.at(-1), search);
        }
        assert.equal(
          (await db.instrument.findUniqueOrThrow({ where: { id: ids[0] } }))
            .isin,
          null,
        );
        assert.equal(await db.asset.count({ where: { userId: users[0] } }), 1);
      },
    );
    await suite.test(
      "selection accepts only the verified listing ID, not obsolete matching details",
      async () => {
        const result = await request("assets", {
          instrumentId: ids[0],
          matching: {
            search: "IWDA",
            exchange: "AEB",
            currency: "EUR",
            confirmed: true,
          },
        });
        assert.equal(result.status, 400);
        assert.equal(
          (await request("assets", { instrumentId: ids[0] })).status,
          201,
        );
      },
    );
    await suite.test(
      "rejects forged metadata, old reference IDs, unauthenticated and malformed queries",
      async () => {
        assert.equal(
          (await request("assets", { instrumentId: `yf:ETF:EUR:FORGED.AS` }))
            .status,
          503,
        );
        assert.equal(
          (
            await request("assets", {
              instrumentId: `av:ETF:EUR:${"f".repeat(48)}`,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("assets", {
              instrumentId: ids[0],
              name: "Injected",
              price: "1",
            })
          ).status,
          400,
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
      },
    );
    await suite.test("removed catalogue aliases are unavailable", async () => {
      assert.equal((await request("instruments")).status, 404);
      assert.equal(
        (await request("instruments/search", { search: prefix })).status,
        404,
      );
    });
    await suite.test(
      "provider throttling returns a sanitized error and never persists an invalid asset",
      async () => {
        external.search = async () => {
          throw new Error("MARKET_RATE_LIMIT");
        };
        const result = await request(`instruments/directory?search=${prefix}`);
        assert.equal(result.status, 503);
        assert.equal(result.body.code, "MARKET_RATE_LIMIT");
        assert.equal(await db.asset.count({ where: { userId: users[0] } }), 1);
      },
    );
  } finally {
    await db.asset.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  }
});
