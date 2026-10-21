import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
// Only this isolated test listener trusts a simulated single reverse proxy.
process.env.TRUST_PROXY = "true";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Auth tests require the dedicated test database");
const { bootstrap } = await import("../src/main.js");

test("per-account login throttling cannot be bypassed by rotating client IPs", async () => {
  const app = await bootstrap(0);
  const url = await app.getUrl();
  const email = `unknown-${randomUUID()}@example.test`;
  try {
    for (let attempt = 0; attempt < 21; attempt++) {
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
          "X-Opulya-Request": "1",
          "X-Forwarded-For": `198.51.100.${attempt + 1}`,
        },
        body: JSON.stringify({
          email: attempt % 2 ? ` ${email.toUpperCase()} ` : email,
          password: "wrong-password",
        }),
      });
      assert.equal(response.status, attempt < 20 ? 401 : 429);
      assert.deepEqual(await response.json(), {
        code: attempt < 20 ? "INVALID_CREDENTIALS" : "RATE_LIMITED",
      });
    }
  } finally {
    await app.close();
  }
});
