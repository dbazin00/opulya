import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as argon2 from "argon2";

process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
const target = new URL(process.env.DATABASE_URL);
if (
  target.pathname !== "/opulya_test" ||
  !["localhost", "127.0.0.1"].includes(target.hostname)
)
  throw new Error("Local opulya_test required");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { PrivacyService } = await import("../src/privacy.js");
const { RetentionService } = await import("../src/retention.js");
const { hashToken } = await import("../src/security.js");

test("privacy controls, isolation, full erasure and retention", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const privacy = app.get(PrivacyService);
  const password = "privacy-fixture-password-123";
  const passwordHash = await argon2.hash(password);
  const users: string[] = [];
  const instrumentId = randomUUID();
  let cookie = "",
    otherCookie = "",
    userId = "",
    otherId = "";
  const request = async (
    path: string,
    body?: unknown,
    method = "POST",
    token = cookie,
    origin = process.env.WEB_ORIGIN!,
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        Cookie: token,
        Origin: origin,
        "X-Opulya-Request": "1",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  };
  const user = async (extra = {}) => {
    const row = await db.user.create({
      data: {
        firstName: "Privacy",
        lastName: "Fixture",
        email: `${randomUUID()}@example.test`,
        passwordHash,
        emailVerifiedAt: new Date(),
        ...extra,
      },
    });
    users.push(row.id);
    return row;
  };
  try {
    const a = await user(),
      b = await user();
    userId = a.id;
    otherId = b.id;
    const login = await request("auth/login", { email: a.email, password });
    cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const second = await request("auth/login", { email: b.email, password });
    otherCookie = second.headers.get("set-cookie")!.split(";")[0]!;
    const oldLogin = await request(
      "auth/login",
      { email: a.email, password },
      "POST",
      "",
    );
    const oldCookie = oldLogin.headers.get("set-cookie")!.split(";")[0]!;
    await db.instrument.create({
      data: {
        id: instrumentId,
        name: "Shared public ETF",
        symbol: "PRIVACY.AS",
        assetType: "ETF",
        exchange: "AMS",
        currency: "EUR",
        identity: randomUUID(),
      },
    });
    const bank = await db.account.create({
      data: {
        userId,
        name: "Archived bank",
        type: "BANK",
        currency: "EUR",
        initialBalance: "100",
        archivedAt: new Date(),
      },
    });
    const investing = await db.account.create({
      data: {
        userId,
        name: "Investing",
        type: "INVESTMENT",
        currency: "EUR",
        initialBalance: "0",
      },
    });
    const category = await db.category.create({
      data: { userId, name: "Parent", type: "EXPENSE", archivedAt: new Date() },
    });
    const child = await db.category.create({
      data: { userId, name: "Child", type: "EXPENSE", parentId: category.id },
    });
    const asset = await db.asset.create({
      data: {
        userId,
        name: "My ETF",
        symbol: "PRIVACY.AS",
        assetType: "ETF",
        currency: "EUR",
        instrumentId,
      },
    });
    const foreignAsset = await db.asset.create({
      data: {
        userId: otherId,
        name: "Other user's ETF",
        symbol: "PRIVACY.AS",
        assetType: "ETF",
        currency: "EUR",
        instrumentId,
      },
    });
    const original = await db.transaction.create({
      data: {
        userId,
        type: "EXPENSE",
        sourceAccountId: bank.id,
        categoryId: category.id,
        amount: "12.34567891",
        currency: "EUR",
        occurredAt: new Date("2026-10-20T12:34:56.123Z"),
        clientRequestId: randomUUID(),
        voidedAt: new Date(),
        description: "Original precise record",
      },
    });
    await db.transaction.create({
      data: {
        userId,
        type: "EXPENSE",
        sourceAccountId: bank.id,
        categoryId: child.id,
        amount: "10",
        currency: "EUR",
        occurredAt: new Date(),
        clientRequestId: randomUUID(),
        replacesId: original.id,
      },
    });
    await db.transaction.create({
      data: {
        userId,
        type: "ADJUSTMENT",
        sourceAccountId: bank.id,
        visibleInHistory: false,
        amount: "1",
        currency: "EUR",
        occurredAt: new Date(),
        clientRequestId: randomUUID(),
      },
    });
    const funding = await db.transaction.create({
      data: {
        userId,
        type: "TRANSFER",
        sourceAccountId: bank.id,
        destinationAccountId: investing.id,
        amount: "20",
        currency: "EUR",
        occurredAt: new Date(),
        clientRequestId: randomUUID(),
      },
    });
    await db.investmentTransaction.create({
      data: {
        userId,
        accountId: investing.id,
        type: "DEPOSIT",
        totalAmount: "20",
        currency: "EUR",
        executedAt: new Date(),
        clientRequestId: randomUUID(),
        fundingTransactionId: funding.id,
      },
    });
    const trade = await db.investmentTransaction.create({
      data: {
        userId,
        accountId: investing.id,
        assetId: asset.id,
        type: "BUY",
        quantity: "1",
        pricePerUnit: "10",
        totalAmount: "10",
        currency: "EUR",
        executedAt: new Date(),
        clientRequestId: randomUUID(),
        voidedAt: new Date(),
      },
    });
    await db.investmentTransaction.create({
      data: {
        userId,
        accountId: investing.id,
        assetId: asset.id,
        type: "BUY",
        quantity: "1",
        pricePerUnit: "11",
        totalAmount: "11",
        currency: "EUR",
        executedAt: new Date(),
        clientRequestId: randomUUID(),
        replacesId: trade.id,
      },
    });
    await db.budget.create({
      data: {
        userId,
        categoryId: child.id,
        currency: "EUR",
        month: "2026-10",
        scope: "RECURRING",
        amount: "100",
      },
    });
    await db.budget.create({
      data: {
        userId,
        assetId: asset.id,
        currency: "EUR",
        month: "2026-10",
        scope: "MONTH",
        amount: "50",
      },
    });
    const counter = `verification:recipient:${hashToken(a.email)}:day:fixture`;
    await db.emailQuota.create({
      data: {
        key: counter,
        count: 1,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    await suite.test(
      "export is authenticated, CSRF-protected and rejects scope injection and incorrect passwords",
      async () => {
        assert.equal(
          (await request("auth/export", { password }, "POST", "")).status,
          401,
        );
        assert.equal(
          (
            await request(
              "auth/export",
              { password },
              "POST",
              cookie,
              "https://attacker.invalid",
            )
          ).status,
          403,
        );
        assert.equal(
          (await request("auth/export", { password, userId: otherId })).status,
          400,
        );
        assert.equal(
          (await request("auth/export", { password: "wrong" })).status,
          401,
        );
      },
    );
    await suite.test(
      "exports complete owner data, exact decimals/timestamps and no credentials",
      async () => {
        const result = await request("auth/export", { password });
        assert.equal(result.status, 201);
        assert.equal(result.headers.get("cache-control"), "no-store");
        assert.match(result.headers.get("content-disposition")!, /attachment/);
        assert.equal(result.body.accounts.length, 2);
        assert.equal(result.body.categories.length, 2);
        assert.equal(result.body.transactions.length, 4);
        assert.equal(result.body.investments.length, 3);
        assert.equal(result.body.budgets.length, 2);
        assert.equal(result.body.assets.length, 1);
        assert.equal(result.body.assets[0].instrument.id, instrumentId);
        assert.equal(
          result.body.transactions.find(
            (row: { id: string }) => row.id === original.id,
          ).amount,
          "12.34567891",
        );
        assert.equal(
          result.body.transactions.find(
            (row: { id: string }) => row.id === original.id,
          ).occurredAt,
          "2026-10-20T12:34:56.123Z",
        );
        const json = JSON.stringify(result.body);
        for (const secret of [
          passwordHash,
          "passwordHash",
          "tokenHash",
          "emailVerificationTokenHash",
          b.email,
          foreignAsset.id,
        ])
          assert.equal(json.includes(secret), false, secret);
        assert.equal(result.body.emailDeliveryCounters[0].count, 1);
      },
    );
    await suite.test(
      "profile corrections cannot alter verified email or another user",
      async () => {
        const result = await request(
          "auth/profile",
          { firstName: "Corrected", lastName: "Name" },
          "PATCH",
        );
        assert.equal(result.status, 200);
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .firstName,
          "Corrected",
        );
        assert.equal(
          (
            await request(
              "auth/profile",
              { firstName: "Bad", lastName: "Name", email: b.email },
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: otherId } }))
            .firstName,
          "Privacy",
        );
      },
    );
    await suite.test(
      "restriction blocks finance and stale writes, revokes other sessions, preserves privacy controls",
      async () => {
        assert.equal(
          (
            await request(
              "auth/processing",
              { password, restricted: true },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request("auth/me", undefined, "GET", oldCookie)).status,
          401,
        );
        assert.equal(
          (await request("accounts")).body.code,
          "PROCESSING_RESTRICTED",
        );
        assert.equal((await request("auth/me")).status, 200);
        assert.equal((await request("auth/export", { password })).status, 201);
        await assert.rejects(
          db.atomic(userId, async () => true),
          /PROCESSING_RESTRICTED/,
        );
        assert.equal(
          (
            await request(
              "auth/processing",
              { password, restricted: false },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal((await request("accounts")).status, 200);
      },
    );
    await suite.test(
      "erasure needs literal confirmation and password, rolls back failures and deletes only the owner",
      async () => {
        assert.equal(
          (await request("auth/account", { password, confirm: "no" }, "DELETE"))
            .status,
          400,
        );
        const version = (
          await db.user.findUniqueOrThrow({ where: { id: userId } })
        ).ledgerVersion;
        assert.equal(
          (
            await request(
              "auth/account",
              { password: "wrong", confirm: "DELETE" },
              "DELETE",
            )
          ).status,
          401,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: userId } }))
            .ledgerVersion,
          version,
        );
        assert.equal(await db.transaction.count({ where: { userId } }), 4);
        const result = await request(
          "auth/account",
          { password, confirm: "DELETE" },
          "DELETE",
        );
        assert.equal(result.status, 200);
        assert.match(result.headers.get("set-cookie")!, /opulya_session=;/);
        assert.equal(await db.user.findUnique({ where: { id: userId } }), null);
        const where = { userId };
        for (const count of [
          await db.account.count({ where }),
          await db.category.count({ where }),
          await db.transaction.count({ where }),
          await db.investmentTransaction.count({ where }),
          await db.asset.count({ where }),
          await db.budget.count({ where }),
          await db.session.count({ where }),
        ])
          assert.equal(count, 0);
        assert.equal(
          await db.emailQuota.findUnique({ where: { key: counter } }),
          null,
        );
        assert.ok(
          await db.instrument.findUnique({ where: { id: instrumentId } }),
        );
        assert.ok(
          await db.asset.findUnique({ where: { id: foreignAsset.id } }),
        );
        assert.equal((await request("auth/me")).status, 401);
        assert.equal(
          (await request("auth/me", undefined, "GET", otherCookie)).status,
          200,
        );
      },
    );
    await suite.test(
      "cleanup removes expired records without deleting verified users, fresh registrations or financial history",
      async () => {
        const now = new Date(),
          old = new Date(now.getTime() - 8 * 86_400_000);
        const pending = await user({
          emailVerifiedAt: null,
          passwordHash: null,
          createdAt: old,
        });
        const fresh = await user({ emailVerifiedAt: null, passwordHash: null });
        const legacy = await user({
          emailVerifiedAt: null,
          passwordHash: null,
          createdAt: old,
        });
        await db.account.create({
          data: {
            userId: legacy.id,
            name: "Do not purge",
            type: "CASH",
            currency: "EUR",
            initialBalance: "0",
          },
        });
        await db.user.update({
          where: { id: fresh.id },
          data: {
            emailVerificationTokenHash: hashToken(randomUUID()),
            emailVerificationExpiresAt: old,
          },
        });
        const expired = await db.session.create({
          data: {
            userId: otherId,
            tokenHash: hashToken(randomUUID()),
            expiresAt: old,
          },
        });
        const idle = await db.session.create({
          data: {
            userId: otherId,
            tokenHash: hashToken(randomUUID()),
            expiresAt: new Date(now.getTime() + 60_000),
            lastSeenAt: old,
          },
        });
        const key = `privacy-test:${randomUUID()}`;
        await db.emailQuota.create({ data: { key, count: 1, expiresAt: old } });
        await app.get(RetentionService).cleanup(now);
        assert.equal(
          await db.user.findUnique({ where: { id: pending.id } }),
          null,
        );
        assert.ok(await db.user.findUnique({ where: { id: otherId } }));
        assert.ok(await db.user.findUnique({ where: { id: legacy.id } }));
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: fresh.id } }))
            .emailVerificationTokenHash,
          null,
        );
        assert.equal(
          await db.session.findUnique({ where: { id: expired.id } }),
          null,
        );
        assert.equal(
          await db.session.findUnique({ where: { id: idle.id } }),
          null,
        );
        assert.equal(await db.emailQuota.findUnique({ where: { key } }), null);
        assert.equal(
          (await request("auth/me", undefined, "GET", otherCookie)).status,
          200,
        );
      },
    );
  } finally {
    for (const id of users) {
      const row = await db.user.findUnique({ where: { id } });
      if (!row) continue;
      if (row.passwordHash)
        await privacy.delete(id, { password, confirm: "DELETE" });
      else {
        await db.account.deleteMany({ where: { userId: id } });
        await db.user.delete({ where: { id } });
      }
    }
    await db.instrument.deleteMany({ where: { id: instrumentId } });
    await app.close();
  }
});
