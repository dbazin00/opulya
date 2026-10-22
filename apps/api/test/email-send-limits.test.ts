import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import { AuthService } from "../src/auth.js";
import { termsVersion } from "@opulya/shared";
import { Database } from "../src/db.js";
import {
  MailService,
  mailSettingsSchema,
  type VerificationMail,
} from "../src/mail.js";
import { verificationQuotas } from "../src/email-budget.js";

test("persistent verification email budgets", async (suite) => {
  const source = new URL(testDatabaseUrl());
  assert.ok(["localhost", "127.0.0.1"].includes(source.hostname));
  assert.equal(source.port, "5434");
  const name = `opulya_email_verify_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  assert.match(name, /^opulya_email_verify_[a-f0-9]{12}$/);
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: source.toString() });
  const previousUrl = process.env.DATABASE_URL;
  const previousOrigin = process.env.WEB_ORIGIN;
  let db: Database | undefined;
  let auth: AuthService | undefined;
  let created = false;
  const delivered: VerificationMail[] = [];
  const settings = mailSettingsSchema.parse({
    EMAIL_SENDS_PER_HOUR: 200,
    EMAIL_SENDS_PER_DAY: 500,
  });
  let failDelivery = false;
  const mail = {
    settings,
    assertReady() {},
    async sendVerification(message: VerificationMail) {
      if (failDelivery) throw new Error("Simulated provider failure");
      delivered.push(message);
    },
  } as MailService;
  const signup = (email: string) => {
    assert.ok(auth);
    return auth.signup({
      firstName: "Budget",
      lastName: "Fixture",
      email,
      acceptTerms: true,
      termsVersion,
    });
  };
  const resend = (email: string) => {
    assert.ok(auth);
    return auth.resendVerification({ email });
  };
  const age = async (email: string) => {
    assert.ok(db);
    await db.user.update({
      where: { email },
      data: { emailVerificationSentAt: new Date(Date.now() - 61_000) },
    });
  };
  const reset = async () => {
    assert.ok(db);
    await auth?.onModuleDestroy();
    await db.user.deleteMany();
    await db.emailQuota.deleteMany();
    delivered.length = 0;
    settings.EMAIL_SENDS_PER_HOUR = 200;
    settings.EMAIL_SENDS_PER_DAY = 500;
    failDelivery = false;
  };
  try {
    await admin.connect();
    // The suite owns only this generated scratch database, never application data.
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(
            "../../../node_modules/prisma/build/index.js",
            import.meta.url,
          ),
        ),
        "migrate",
        "deploy",
      ],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { ...process.env, DATABASE_URL: target.toString() },
        timeout: 60_000,
        stdio: "pipe",
      },
    );
    process.env.DATABASE_URL = target.toString();
    process.env.WEB_ORIGIN = "http://localhost:3000";
    db = new Database();
    auth = new AuthService(db, mail);

    await suite.test(
      "signup and normalized resend share the server cooldown",
      async () => {
        await reset();
        const email = "cooldown@example.test";
        assert.deepEqual(await signup(email), { ok: true });
        assert.deepEqual(await resend(" COOLDOWN@EXAMPLE.TEST "), { ok: true });
        assert.deepEqual(await signup(email), { ok: true });
        assert.equal(delivered.length, 1);
        assert.equal(
          (await db!.emailQuota.findMany()).every((q) => q.count === 1),
          true,
        );
      },
    );
    await suite.test(
      "recipient hourly budget persists across service instances and preserves the valid token",
      async () => {
        await reset();
        const email = "recipient@example.test";
        await signup(email);
        for (let i = 0; i < 2; i++) {
          await age(email);
          await resend(email);
        }
        assert.equal(delivered.length, 3);
        const before = await db!.user.findUniqueOrThrow({ where: { email } });
        await age(email);
        await auth!.onModuleDestroy();
        auth = new AuthService(db!, mail);
        assert.deepEqual(await resend(email), { ok: true });
        assert.equal(delivered.length, 3);
        const after = await db!.user.findUniqueOrThrow({ where: { email } });
        assert.equal(
          after.emailVerificationTokenHash,
          before.emailVerificationTokenHash,
        );
        assert.deepEqual(
          after.emailVerificationExpiresAt,
          before.emailVerificationExpiresAt,
        );
        assert.equal(
          (await db!.emailQuota.findMany()).every((q) => q.count === 3),
          true,
        );
        const message = delivered.at(-1);
        assert.ok(message);
        const token = new URLSearchParams(
          new URL(message.verificationUrl).hash.slice(1),
        ).get("token");
        assert.deepEqual(
          await auth!.verifyEmail({
            token,
            password: "mailbox-owner-password-456",
          }),
          { ok: true },
        );
      },
    );
    await suite.test(
      "daily recipient limit blocks further mail even in a new hourly window",
      async () => {
        await reset();
        const email = "daily-recipient@example.test";
        await signup(email);
        await age(email);
        const quota = verificationQuotas(email, settings, new Date()).find(
          (q) => q.key.includes("recipient:") && q.key.includes(":day:"),
        );
        assert.ok(quota);
        await db!.emailQuota.update({
          where: { key: quota.key },
          data: { count: 5 },
        });
        assert.deepEqual(await resend(email), { ok: true });
        assert.equal(delivered.length, 1);
        const globals = await db!.emailQuota.findMany({
          where: { key: { contains: ":global:" } },
        });
        assert.equal(
          globals.every((q) => q.count === 1),
          true,
        );
      },
    );
    await suite.test(
      "concurrent distinct recipients cannot exceed the shared hourly cap",
      async () => {
        await reset();
        settings.EMAIL_SENDS_PER_HOUR = 2;
        const responses = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            signup(`parallel-${i}@example.test`),
          ),
        );
        assert.equal(
          responses.every((r) => r.ok === true),
          true,
        );
        await auth!.onModuleDestroy();
        assert.equal(delivered.length, 2);
        const globals = await db!.emailQuota.findMany({
          where: { key: { contains: ":global:" } },
        });
        assert.equal(
          globals.every((q) => q.count === 2),
          true,
        );
        assert.equal(
          await db!.user.count({
            where: { emailVerificationTokenHash: { not: null } },
          }),
          2,
        );
      },
    );
    await suite.test(
      "global daily cap applies to signup and resend and survives service replacement",
      async () => {
        await reset();
        settings.EMAIL_SENDS_PER_DAY = 1;
        await signup("global-first@example.test");
        await auth!.onModuleDestroy();
        auth = new AuthService(db!, mail);
        await signup("global-second@example.test");
        await age("global-first@example.test");
        await resend("global-first@example.test");
        assert.equal(delivered.length, 1);
        assert.equal(
          (
            await db!.emailQuota.findMany({
              where: { key: { contains: ":global:" } },
            })
          ).every((q) => q.count === 1),
          true,
        );
      },
    );
    await suite.test(
      "zero budget disables sending without storing a verification token",
      async () => {
        await reset();
        settings.EMAIL_SENDS_PER_DAY = 0;
        assert.deepEqual(await signup("disabled@example.test"), { ok: true });
        assert.equal(delivered.length, 0);
        assert.equal(await db!.emailQuota.count(), 0);
        assert.equal(
          (
            await db!.user.findUniqueOrThrow({
              where: { email: "disabled@example.test" },
            })
          ).emailVerificationTokenHash,
          null,
        );
      },
    );
    await suite.test(
      "unknown and verified recipients neither send mail nor spend the budget",
      async () => {
        await reset();
        await db!.user.create({
          data: {
            firstName: "Verified",
            lastName: "Fixture",
            email: "verified@example.test",
            emailVerifiedAt: new Date(),
          },
        });
        for (const email of ["unknown@example.test", "verified@example.test"])
          assert.deepEqual(await resend(email), { ok: true });
        assert.deepEqual(await signup("verified@example.test"), { ok: true });
        assert.equal(delivered.length, 0);
        assert.equal(await db!.emailQuota.count(), 0);
      },
    );
    await suite.test(
      "failed delivery consumes the reservation and invalidates its failed token",
      async () => {
        await reset();
        failDelivery = true;
        await signup("failure@example.test");
        await auth!.onModuleDestroy();
        assert.equal(delivered.length, 0);
        assert.equal(
          (await db!.emailQuota.findMany()).every((q) => q.count === 1),
          true,
        );
        const user = await db!.user.findUniqueOrThrow({
          where: { email: "failure@example.test" },
        });
        assert.equal(user.emailVerificationTokenHash, null);
        assert.equal(user.emailVerificationExpiresAt, null);
        assert.ok(user.emailVerificationSentAt);
      },
    );
    await suite.test(
      "concurrent resends claim one send and expired quota rows are cleaned",
      async () => {
        await reset();
        const email = "same@example.test";
        await signup(email);
        await age(email);
        await db!.emailQuota.create({
          data: { key: "expired", count: 80, expiresAt: new Date(0) },
        });
        await Promise.all(Array.from({ length: 6 }, () => resend(email)));
        await auth!.onModuleDestroy();
        assert.equal(delivered.length, 2);
        assert.equal(
          await db!.emailQuota.findUnique({ where: { key: "expired" } }),
          null,
        );
        assert.equal(
          (await db!.emailQuota.findMany()).some((q) => q.key.includes(email)),
          false,
        );
      },
    );
  } finally {
    await auth?.onModuleDestroy();
    await db?.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
  }
});
