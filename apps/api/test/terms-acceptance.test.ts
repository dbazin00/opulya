import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { termsVersion } from "@opulya/shared";

process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.EMAIL_SENDS_PER_HOUR = "10000";
process.env.EMAIL_SENDS_PER_DAY = "10000";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Dedicated test database required");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { MailService } = await import("../src/mail.js");
const { AuthService } = await import("../src/auth.js");

test("signup terms acceptance is validated and recorded by the server", async (suite) => {
  const app = await bootstrap(0);
  const url = await app.getUrl();
  const db = app.get(Database);
  const mail = app.get(MailService);
  const emails: string[] = [];
  const address = () => {
    const email = `terms-${randomUUID()}@example.test`;
    emails.push(email);
    return email;
  };
  const post = (path: string, body: unknown) =>
    fetch(`${url}/api/${path}`, {
      method: "POST",
      headers: {
        Origin: process.env.WEB_ORIGIN!,
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const input = (email: string) => ({
    firstName: "Alex",
    lastName: "Terms",
    email,
    acceptTerms: true,
    termsVersion,
  });
  let email = "";
  let acceptedAt: Date | null = null;
  try {
    await suite.test(
      "rejects missing, false, string and obsolete acceptance before creating users or sending mail",
      async () => {
        for (const override of [
          { acceptTerms: undefined },
          { acceptTerms: false },
          { acceptTerms: "true" },
          { termsVersion: undefined },
          { termsVersion: "obsolete" },
          { termsAcceptedAt: "2000-01-01T00:00:00Z" },
        ]) {
          const email = address();
          const response = await post("auth/signup", {
            ...input(email),
            ...override,
          });
          assert.equal(response.status, 400);
          assert.deepEqual(await response.json(), { code: "VALIDATION_ERROR" });
          assert.equal(await db.user.count({ where: { email } }), 0);
          assert.equal(mail.testMail(email), undefined);
        }
      },
    );
    await suite.test(
      "stores the current version and a server-generated timestamp with the pending user",
      async () => {
        email = address();
        const before = Date.now();
        const response = await post("auth/signup", input(email));
        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), { ok: true });
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        assert.equal(user.emailVerifiedAt, null);
        assert.equal(user.termsVersion, termsVersion);
        assert.ok(user.termsAcceptedAt);
        assert.ok(user.termsAcceptedAt.getTime() >= before);
        assert.ok(user.termsAcceptedAt.getTime() <= Date.now());
        acceptedAt = user.termsAcceptedAt;
      },
    );
    await suite.test(
      "email verification and duplicate signup preserve acceptance rather than rewriting it",
      async () => {
        const message = mail.testMail(email);
        assert.ok(message);
        const token = new URLSearchParams(
          new URL(message.verificationUrl).hash.slice(1),
        ).get("token");
        const verify = await post("auth/verify-email", {
          token,
          password: "verified-terms-password-123",
        });
        assert.equal(verify.status, 201);
        const duplicate = await post("auth/signup", {
          ...input(email),
          firstName: "Someone else",
        });
        assert.equal(duplicate.status, 201);
        assert.deepEqual(await duplicate.json(), { ok: true });
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        assert.equal(user.firstName, "Alex");
        assert.equal(user.termsVersion, termsVersion);
        assert.deepEqual(user.termsAcceptedAt, acceptedAt);
        assert.ok(user.emailVerifiedAt);
      },
    );
    await suite.test(
      "never invents acceptance for an existing legacy user",
      async () => {
        const email = address();
        await db.user.create({
          data: {
            firstName: "Legacy",
            lastName: "User",
            email,
            emailVerifiedAt: new Date(),
          },
        });
        const response = await post("auth/signup", input(email));
        assert.equal(response.status, 201);
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        assert.equal(user.termsVersion, null);
        assert.equal(user.termsAcceptedAt, null);
      },
    );
  } finally {
    try {
      await app.get(AuthService).onModuleDestroy();
      await db.user.deleteMany({ where: { email: { in: emails } } });
    } finally {
      await app.close();
    }
  }
});
