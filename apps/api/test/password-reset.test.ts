import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";
import type { Response } from "express";

process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.EMAIL_SENDS_PER_HOUR = "10000";
process.env.EMAIL_SENDS_PER_DAY = "10000";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { MailService } = await import("../src/mail.js");
const { AuthService } = await import("../src/auth.js");
const { RetentionService } = await import("../src/retention.js");
const { hashToken } = await import("../src/security.js");

test("password recovery is private, single-use and revokes old credentials", async (suite) => {
  const app = await bootstrap(0);
  const url = await app.getUrl();
  const db = app.get(Database);
  const mail = app.get(MailService);
  const auth = app.get(AuthService);
  const originalPassword = "original-password-for-reset-123";
  const newPassword = "new-password-after-reset-456";
  const passwordHash = await argon2.hash(originalPassword);
  const users: string[] = [];
  const createUser = async (verified = true, locale = "en") => {
    const user = await db.user.create({
      data: {
        firstName: "Reset",
        lastName: "Owner",
        email: `reset-${randomUUID()}@example.test`,
        locale,
        passwordHash: verified ? passwordHash : null,
        emailVerifiedAt: verified ? new Date() : null,
      },
    });
    users.push(user.id);
    return user;
  };
  const request = async (
    path: string,
    body?: unknown,
    cookie = "",
    origin = process.env.WEB_ORIGIN!,
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
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
      headers: response.headers,
    };
  };
  const tokenFor = (email: string) =>
    new URLSearchParams(
      new URL(mail.testPasswordResetMail(email)!.resetUrl).hash.slice(1),
    ).get("token")!;
  const allowResend = (id: string) =>
    db.user.update({
      where: { id },
      data: { passwordResetSentAt: new Date(Date.now() - 61000) },
    });
  try {
    const owner = await createUser(true, "hr");
    const pending = await createUser(false);
    const other = await createUser();
    let token = "";
    const cookie = (
      await request("auth/login", {
        email: owner.email,
        password: originalPassword,
      })
    ).cookie!;
    const otherCookie = (
      await request("auth/login", {
        email: other.email,
        password: originalPassword,
      })
    ).cookie!;
    const staleLogin = await auth.login({
      email: owner.email,
      password: originalPassword,
    });

    await suite.test(
      "returns identical acknowledgements for existing, unknown and unverified addresses",
      async () => {
        for (const email of [
          owner.email.toUpperCase(),
          pending.email,
          `unknown-${randomUUID()}@example.test`,
        ]) {
          const result = await request("auth/forgot-password", { email });
          assert.equal(result.status, 201);
          assert.deepEqual(result.body, { ok: true });
          assert.equal(result.cookie, undefined);
          assert.equal(result.headers.get("cache-control"), "no-store");
        }
        assert.equal(mail.testPasswordResetMail(pending.email), undefined);
        assert.equal(mail.testPasswordResetMail(owner.email)!.locale, "hr");
        token = tokenFor(owner.email);
        const user = await db.user.findUniqueOrThrow({
          where: { id: owner.id },
        });
        assert.equal(user.passwordResetTokenHash, hashToken(token));
        assert.notEqual(user.passwordResetTokenHash, token);
        assert.equal(user.passwordHash, passwordHash);
        const link = new URL(mail.testPasswordResetMail(owner.email)!.resetUrl);
        assert.equal(link.origin, process.env.WEB_ORIGIN);
        assert.equal(link.pathname, "/reset-password");
        assert.equal(link.search, "");
        assert.ok(
          user.passwordResetExpiresAt!.getTime() - Date.now() <= 1800000,
        );
        assert.equal((await request("auth/me", undefined, cookie)).status, 200);
      },
    );
    await suite.test(
      "cooldown and failed validation preserve a usable token",
      async () => {
        await request("auth/forgot-password", { email: owner.email });
        assert.equal(tokenFor(owner.email), token);
        assert.equal(
          (
            await request("auth/forgot-password", {
              email: owner.email,
              userId: other.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (await request("auth/reset-password", { token, password: "short" }))
            .status,
          400,
        );
        assert.equal(
          (
            await request("auth/reset-password", {
              token,
              password: newPassword,
              userId: other.id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await request("auth/reset-password", {
              token: "invalid",
              password: newPassword,
            })
          ).status,
          400,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
            .passwordResetTokenHash,
          hashToken(token),
        );
      },
    );
    await suite.test(
      "GET and cross-origin submissions cannot consume reset tokens",
      async () => {
        assert.equal((await request("auth/reset-password")).status, 404);
        assert.equal(
          (
            await request(
              "auth/reset-password",
              { token, password: newPassword },
              "",
              "https://attacker.invalid",
            )
          ).status,
          403,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
            .passwordHash,
          passwordHash,
        );
      },
    );
    await suite.test(
      "verification tokens cannot reset passwords or activate via recovery",
      async () => {
        const verificationToken = "c".repeat(64);
        await db.user.update({
          where: { id: pending.id },
          data: {
            emailVerificationTokenHash: hashToken(verificationToken),
            emailVerificationExpiresAt: new Date(Date.now() + 60000),
          },
        });
        assert.equal(
          (
            await request("auth/reset-password", {
              token: verificationToken,
              password: newPassword,
            })
          ).body.code,
          "INVALID_PASSWORD_RESET",
        );
        assert.equal(
          (await request("auth/verify-email", { token, password: newPassword }))
            .body.code,
          "INVALID_VERIFICATION",
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: pending.id } }))
            .emailVerifiedAt,
          null,
        );
      },
    );
    await suite.test(
      "rejects expired links, replaces old links and rolls back quota failures",
      async () => {
        await db.user.update({
          where: { id: owner.id },
          data: { passwordResetExpiresAt: new Date(0) },
        });
        assert.equal(
          (
            await request("auth/reset-password", {
              token,
              password: newPassword,
            })
          ).body.code,
          "INVALID_PASSWORD_RESET",
        );
        await allowResend(owner.id);
        mail.settings.EMAIL_SENDS_PER_HOUR = 0;
        assert.equal(
          (await request("auth/forgot-password", { email: owner.email }))
            .status,
          201,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
            .passwordResetTokenHash,
          hashToken(token),
        );
        mail.settings.EMAIL_SENDS_PER_HOUR = 10000;
        await request("auth/forgot-password", { email: owner.email });
        const replacement = tokenFor(owner.email);
        assert.notEqual(replacement, token);
        assert.equal(
          (
            await request("auth/reset-password", {
              token,
              password: newPassword,
            })
          ).body.code,
          "INVALID_PASSWORD_RESET",
        );
        token = replacement;
      },
    );
    await suite.test(
      "only one concurrent reset succeeds and only the owner's sessions are revoked",
      async () => {
        const results = await Promise.all([
          request("auth/reset-password", { token, password: newPassword }),
          request("auth/reset-password", { token, password: newPassword }),
        ]);
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [201, 400],
        );
        const user = await db.user.findUniqueOrThrow({
          where: { id: owner.id },
        });
        assert.ok(await argon2.verify(user.passwordHash!, newPassword));
        assert.equal(user.passwordResetTokenHash, null);
        assert.equal(user.passwordResetExpiresAt, null);
        assert.equal((await request("auth/me", undefined, cookie)).status, 401);
        assert.equal(
          (await request("auth/me", undefined, otherCookie)).status,
          200,
        );
        assert.equal(
          (
            await request("auth/reset-password", {
              token,
              password: newPassword,
            })
          ).body.code,
          "INVALID_PASSWORD_RESET",
        );
        assert.equal(
          (
            await request("auth/login", {
              email: owner.email,
              password: originalPassword,
            })
          ).status,
          401,
        );
        const login = await request("auth/login", {
          email: owner.email,
          password: newPassword,
        });
        assert.equal(login.status, 201);
        assert.equal("passwordHash" in login.body, false);
        assert.equal(
          "passwordResetTokenHash" in
            (await request("auth/me", undefined, login.cookie)).body,
          false,
        );
      },
    );
    await suite.test(
      "a login that validated the previous password cannot create a session after reset",
      async () => {
        let issuedCookie = false;
        await assert.rejects(
          () =>
            auth.startSession(staleLogin, {
              cookie: () => {
                issuedCookie = true;
              },
            } as unknown as Response),
          /INVALID_CREDENTIALS/,
        );
        assert.equal(issuedCookie, false);
      },
    );
    await suite.test(
      "delivery failure invalidates only the failed reset token",
      async () => {
        const user = await createUser();
        const send = mail.sendPasswordReset.bind(mail);
        mail.sendPasswordReset = async () => {
          throw new Error("provider secret should not be exposed");
        };
        try {
          assert.deepEqual(
            (await request("auth/forgot-password", { email: user.email })).body,
            { ok: true },
          );
          await auth.onModuleDestroy();
          const saved = await db.user.findUniqueOrThrow({
            where: { id: user.id },
          });
          assert.equal(saved.passwordResetTokenHash, null);
          assert.equal(saved.passwordResetExpiresAt, null);
          assert.equal(saved.passwordHash, passwordHash);
        } finally {
          mail.sendPasswordReset = send;
        }
      },
    );
    await suite.test(
      "retention clears expired recovery secrets without changing credentials",
      async () => {
        await db.user.update({
          where: { id: other.id },
          data: {
            passwordResetTokenHash: hashToken("d".repeat(64)),
            passwordResetExpiresAt: new Date(0),
            passwordResetSentAt: new Date(0),
          },
        });
        await app.get(RetentionService).cleanup();
        const saved = await db.user.findUniqueOrThrow({
          where: { id: other.id },
        });
        assert.equal(saved.passwordResetTokenHash, null);
        assert.equal(saved.passwordResetExpiresAt, null);
        assert.equal(saved.passwordResetSentAt, null);
        assert.equal(saved.passwordHash, passwordHash);
      },
    );
    await suite.test(
      "notification failure does not undo recovery or lift privacy restrictions",
      async () => {
        const user = await createUser();
        const restrictedAt = new Date();
        await db.user.update({
          where: { id: user.id },
          data: { processingRestrictedAt: restrictedAt },
        });
        await request("auth/forgot-password", { email: user.email });
        const send = mail.sendPasswordChanged.bind(mail);
        mail.sendPasswordChanged = async () => {
          throw new Error("delivery unavailable");
        };
        try {
          assert.equal(
            (
              await request("auth/reset-password", {
                token: tokenFor(user.email),
                password: newPassword,
              })
            ).status,
            201,
          );
          await auth.onModuleDestroy();
          const saved = await db.user.findUniqueOrThrow({
            where: { id: user.id },
          });
          assert.ok(await argon2.verify(saved.passwordHash!, newPassword));
          assert.equal(saved.passwordResetTokenHash, null);
          assert.equal(
            saved.processingRestrictedAt!.getTime(),
            restrictedAt.getTime(),
          );
          assert.equal(
            await db.session.count({ where: { userId: user.id } }),
            0,
          );
        } finally {
          mail.sendPasswordChanged = send;
        }
      },
    );
    await suite.test(
      "rate limits normalized recipient addresses even when they do not exist",
      async () => {
        const email = `limited-${randomUUID()}@example.test`;
        for (let attempt = 0; attempt < 6; attempt++) {
          const value = attempt % 2 ? ` ${email.toUpperCase()} ` : email;
          assert.equal(
            (await request("auth/forgot-password", { email: value })).status,
            201,
          );
        }
        assert.equal(
          (await request("auth/forgot-password", { email })).status,
          429,
        );
      },
    );
  } finally {
    await auth.onModuleDestroy();
    for (const id of users) {
      const user = await db.user.findUnique({ where: { id } });
      if (user)
        await db.emailQuota.deleteMany({
          where: {
            key: {
              startsWith: `verification:recipient:${hashToken(user.email)}:`,
            },
          },
        });
    }
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
