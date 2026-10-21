import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ServiceUnavailableException } from "@nestjs/common";
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
const { hashToken } = await import("../src/security.js");

test("email ownership verification and activation security", async (suite) => {
  const app = await bootstrap(0),
    url = await app.getUrl(),
    db = app.get(Database),
    mail = app.get(MailService);
  const emails: string[] = [];
  const password = "signup-original-password-123",
    finalPassword = "mailbox-owner-final-password-456";
  let email = "",
    userId = "",
    token = "";
  const request = async (path: string, body?: unknown, cookie = "") => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: "http://localhost:3000",
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const signup = async (locale = "en") => {
    const address = `verification-${randomUUID()}@example.test`;
    emails.push(address);
    const result = await request("auth/signup", {
      firstName: "Email",
      lastName: "Owner",
      email: address,
      locale,
    });
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, { ok: true });
    assert.equal(result.cookie, undefined);
    return address;
  };
  const tokenFor = (address: string) =>
    new URLSearchParams(
      new URL(mail.testMail(address)!.verificationUrl).hash.slice(1),
    ).get("token")!;
  try {
    await suite.test(
      "signup returns a generic acknowledgement without a session and stores only a token hash",
      async () => {
        email = await signup("hr");
        const user = await db.user.findUniqueOrThrow({ where: { email } });
        userId = user.id;
        token = tokenFor(email);
        assert.equal(user.emailVerifiedAt, null);
        assert.equal(await db.session.count({ where: { userId } }), 0);
        assert.equal(user.passwordHash, null);
        assert.equal(user.emailVerificationTokenHash, hashToken(token));
        assert.notEqual(user.emailVerificationTokenHash, token);
        assert.equal(mail.testMail(email)!.locale, "hr");
        assert.equal(new URL(mail.testMail(email)!.verificationUrl).search, "");
        assert.equal(
          (await request("auth/login", { email, password })).status,
          401,
        );
        assert.equal(
          (await request("auth/login", { email, password: "wrong" })).status,
          401,
        );
        const sessionToken = "a".repeat(64);
        await db.session.create({
          data: {
            userId,
            tokenHash: hashToken(sessionToken),
            expiresAt: new Date(Date.now() + 3600000),
          },
        });
        assert.equal(
          (
            await request(
              "accounts",
              undefined,
              `opulya_session=${sessionToken}`,
            )
          ).status,
          403,
        );
      },
    );
    await suite.test(
      "signup rejects credentials and verification enforces password strength without consuming the token",
      async () => {
        assert.equal(
          (
            await request("auth/signup", {
              firstName: "Untrusted",
              lastName: "Password",
              email,
              password,
            })
          ).status,
          400,
        );
        for (const length of [14, 129]) {
          const invalid = await request("auth/verify-email", {
            token,
            password: "a".repeat(length),
          });
          assert.equal(invalid.status, 400);
          assert.equal(invalid.body.code, "VALIDATION_ERROR");
        }
        const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
        assert.equal(user.passwordHash, null);
        assert.equal(user.emailVerifiedAt, null);
        assert.equal(user.emailVerificationTokenHash, hashToken(token));
      },
    );
    await suite.test(
      "resend cooldown preserves the active token and unknown addresses have the same acknowledgement",
      async () => {
        const resend = await request("auth/resend-verification", { email });
        assert.deepEqual(resend.body, { ok: true });
        assert.equal(tokenFor(email), token);
        assert.deepEqual(
          (
            await request("auth/resend-verification", {
              email: `unknown-${randomUUID()}@example.test`,
            })
          ).body,
          resend.body,
        );
        await db.user.update({
          where: { id: userId },
          data: { emailVerificationSentAt: new Date(Date.now() - 61000) },
        });
        await request("auth/resend-verification", { email });
        const newer = tokenFor(email);
        assert.notEqual(newer, token);
        assert.equal(
          (
            await request("auth/verify-email", {
              token,
              password: finalPassword,
            })
          ).status,
          400,
        );
        token = newer;
      },
    );
    await suite.test(
      "verification consumes the token atomically, finalizes the owner's password and invalidates old sessions",
      async () => {
        const results = await Promise.all([
          request("auth/verify-email", { token, password: finalPassword }),
          request("auth/verify-email", { token, password: finalPassword }),
        ]);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [201, 400],
        );
        for (const result of results) assert.equal(result.cookie, undefined);
        const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
        assert.ok(user.emailVerifiedAt);
        assert.ok(user.passwordHash);
        assert.match(user.passwordHash, /^\$argon2id\$/);
        assert.equal(user.emailVerificationTokenHash, null);
        assert.equal(user.emailVerificationExpiresAt, null);
        assert.equal(await db.session.count({ where: { userId } }), 0);
        assert.equal(
          (await request("auth/login", { email, password })).status,
          401,
        );
        const login = await request("auth/login", {
          email,
          password: finalPassword,
        });
        assert.equal(login.status, 201);
        assert.ok(login.cookie);
        assert.equal(
          (await request("accounts", undefined, login.cookie)).status,
          200,
        );
        assert.equal(
          (
            await request("auth/verify-email", {
              token,
              password: finalPassword,
            })
          ).status,
          400,
        );
      },
    );
    await suite.test(
      "verified-account signup cannot overwrite credentials or issue another verification token",
      async () => {
        const before = await db.user.findUniqueOrThrow({
          where: { id: userId },
        });
        const duplicate = await request("auth/signup", {
          firstName: "Attacker",
          lastName: "Other",
          email,
        });
        assert.deepEqual(duplicate.body, { ok: true });
        assert.equal(duplicate.cookie, undefined);
        const after = await db.user.findUniqueOrThrow({
          where: { id: userId },
        });
        assert.equal(after.passwordHash, before.passwordHash);
        assert.equal(after.firstName, before.firstName);
        assert.equal(after.emailVerificationTokenHash, null);
      },
    );
    await suite.test(
      "rejects expired, forged and malformed tokens and client-supplied verification flags",
      async () => {
        const address = await signup(),
          expired = tokenFor(address);
        await db.user.update({
          where: { email: address },
          data: { emailVerificationExpiresAt: new Date(Date.now() - 1000) },
        });
        for (const value of [expired, "b".repeat(64), "bad"])
          assert.equal(
            (
              await request("auth/verify-email", {
                token: value,
                password: finalPassword,
              })
            ).status,
            400,
          );
        assert.equal(
          (
            await request("auth/signup", {
              firstName: "Bad",
              lastName: "Flag",
              email: "flag@example.test",
              emailVerifiedAt: new Date().toISOString(),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("auth/verify-email", {
              token: expired,
              password: finalPassword,
              userId,
            })
          ).status,
          400,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { email: address } }))
            .emailVerifiedAt,
          null,
        );
      },
    );
    await suite.test(
      "delivery failure leaves the account unverified and the failed token unusable",
      async () => {
        const send = mail.sendVerification.bind(mail);
        mail.sendVerification = async () => {
          throw new Error("Delivery failed");
        };
        const address = await signup();
        await new Promise((resolve) => setTimeout(resolve, 100));
        const user = await db.user.findUniqueOrThrow({
          where: { email: address },
        });
        assert.equal(user.emailVerifiedAt, null);
        assert.equal(user.emailVerificationTokenHash, null);
        mail.sendVerification = send;
      },
    );
    await suite.test(
      "signup and resend share a normalized per-address abuse limit",
      async () => {
        const address = `quota-${randomUUID()}@example.test`;
        for (let i = 0; i < 6; i++)
          assert.equal(
            (
              await request("auth/resend-verification", {
                email: i % 2 ? ` ${address.toUpperCase()} ` : address,
              })
            ).status,
            201,
          );
        assert.equal(
          (
            await request("auth/signup", {
              firstName: "Rate",
              lastName: "Limit",
              email: address,
            })
          ).status,
          429,
        );
        assert.equal(await db.user.count({ where: { email: address } }), 0);
      },
    );
    await suite.test(
      "missing credentials fail closed without creating a pending account",
      async () => {
        const original = mail.assertReady.bind(mail);
        mail.assertReady = () => {
          throw new ServiceUnavailableException("MAIL_NOT_CONFIGURED");
        };
        const address = `unconfigured-${randomUUID()}@example.test`;
        assert.equal(
          (
            await request("auth/signup", {
              firstName: "No",
              lastName: "Mail",
              email: address,
            })
          ).status,
          503,
        );
        assert.equal(await db.user.count({ where: { email: address } }), 0);
        mail.assertReady = original;
      },
    );
  } finally {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await app.close();
  }
});
