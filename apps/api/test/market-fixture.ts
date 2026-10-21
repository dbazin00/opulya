import "dotenv/config";
import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Instrument } from "../src/generated/prisma/client.js";

export async function marketFixture(context: TestContext) {
  Object.assign(process.env, {
    OPULYA_TEST: "1",
    NODE_ENV: "test",
    EMAIL_TRANSPORT: "test",
    MARKET_DATA_ENABLED: "true",
    DATABASE_URL: testDatabaseUrl(),
    WEB_ORIGIN: "http://localhost:3000",
  });
  const { bootstrap } = await import("../src/main.js");
  const { Database } = await import("../src/db.js");
  const { InstrumentProvider, InstrumentsService, instrumentIdentity } =
    await import("../src/instruments.js");
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const external = app.get(InstrumentProvider),
    instruments = app.get(InstrumentsService);
  const users: string[] = [],
    cookies: string[] = [],
    ids: string[] = [];
  // Avoid random fixture symbols accidentally matching the ISIN format.
  const prefix =
    "LIVE-" + randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  let calls = 0,
    value = "123.45",
    error: string | null = null,
    offset = 0;
  const originalNow = Date.now;
  const clock = context.mock.method(Date, "now", () => originalNow() + offset);
  external.current = async (_mapping, instrument) => {
    calls++;
    if (error) throw new Error(error);
    const now = new Date(Date.now());
    return {
      price: value,
      currency: instrument.currency,
      kind: "QUOTE",
      provider: "Yahoo Finance",
      marketAt: now,
      fetchedAt: now,
      delayMinutes: 15,
      marketState: "REGULAR",
    };
  };
  const request = async (
    path: string,
    body?: unknown,
    cookie = cookies[0] ?? "",
    method?: string,
    background = false,
  ) => {
    const response = await fetch(url + "/api/" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: {
        Cookie: cookie,
        Origin: "http://localhost:3000",
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
        ...(background ? { "X-Opulya-Poll": "1" } : {}),
      },
      body:
        body === undefined
          ? undefined
          : JSON.stringify(
              path === "auth/signup"
                ? signupRequestBody(body)
                : path === "investments"
                  ? { ...(body as object), clientRequestId: randomUUID() }
                  : body,
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
  const create = async (name: string, body: unknown, cookie?: string) => {
    const result = await request(name, body, cookie);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body;
  };
  // Keep explicit sessions rather than relying on a browser cookie jar.
  for (let i = 0; i < 2; i++) {
    const result = await request(
      "auth/signup",
      {
        firstName: "Live",
        lastName: "Test",
        email: prefix.toLowerCase() + "-" + i + "@example.test",
        password: "integration-password-123",
        locale: "en",
      },
      "",
    );
    assert.equal(result.status, 201);
    users.push(result.body.id);
    cookies.push(result.cookie!);
  }
  const sources: Instrument[] = [];
  for (const assetType of ["ETF", "CRYPTO"] as const) {
    const source = {
      symbol: assetType === "ETF" ? prefix + ".AS" : prefix + "/EUR",
      name: "Public " + assetType + " fixture",
      assetType,
      exchange: assetType === "ETF" ? "AMS" : "",
      mic: assetType === "ETF" ? "XAMS" : "",
      currency: "EUR",
      timeZone: "Europe/Amsterdam",
      isin: null,
    };
    const row = await db.instrument.create({
      data: {
        ...source,
        identity: instrumentIdentity(source),
        mappings: {
          create: {
            provider: "Yahoo Finance",
            symbol: assetType === "CRYPTO" ? prefix + "-EUR" : source.symbol,
            exchange: source.exchange,
            mic: source.mic,
            currency: source.currency,
          },
        },
      },
    });
    ids.push(row.id);
    sources.push(row);
  }
  external.search = async (_query, type, currency) =>
    sources.filter(
      (row) =>
        (!type || row.assetType === type) &&
        (!currency || row.currency === currency),
    );
  return {
    app,
    db,
    external,
    instruments,
    request,
    create,
    users,
    cookies,
    ids,
    sources,
    prefix,
    calls: () => calls,
    setPrice: (price: string) => {
      value = price;
      error = null;
    },
    fail: (code: string) => {
      error = code;
    },
    advance: (ms: number) => {
      offset += ms;
    },
    close: async () => {
      clock.mock.restore();
      await db.investmentTransaction.deleteMany({
        where: { userId: { in: users } },
      });
      await db.transaction.deleteMany({ where: { userId: { in: users } } });
      await db.asset.deleteMany({ where: { userId: { in: users } } });
      await db.account.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.instrument.deleteMany({ where: { id: { in: ids } } });
      await app.close();
    },
  };
}
