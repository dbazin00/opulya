import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.ALPHA_VANTAGE_API_KEY = "";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Dedicated test database required");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { InstrumentsService } = await import("../src/instruments.js");

test("investment corrections retain history and replace linked funding atomically", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const users: string[] = [],
    instruments: string[] = [];
  let cookie = "",
    foreign = "",
    bank = "",
    second = "",
    account = "",
    asset = "",
    buyId = "",
    correctedId = "",
    saleId = "",
    originalFundingId = "";
  const base = Date.now() - 4 * 3600000;
  const at = (offset: number) => new Date(base + offset).toISOString();
  const request = async (path: string, body?: unknown, token = cookie) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Cookie: token,
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
  const createAccount = async (
    name: string,
    initialBalance: string,
    type = "BANK",
    token = cookie,
  ) => {
    const result = await request(
      "accounts",
      { name, initialBalance, type, currency: "EUR" },
      token,
    );
    assert.equal(result.status, 201);
    return result.body.id as string;
  };
  const buy = (extra: Record<string, unknown> = {}) => ({
    accountId: account,
    sourceAccountId: bank,
    assetId: asset,
    type: "BUY",
    quantity: "10",
    pricePerUnit: "10",
    totalAmount: "100",
    fee: "2.25",
    currency: "EUR",
    executedAt: at(0),
    clientRequestId: randomUUID(),
    ...extra,
  });
  const balances = async () =>
    Object.fromEntries(
      (await request("accounts")).body.map(
        (row: { id: string; currentBalance: string }) => [
          row.id,
          row.currentBalance,
        ],
      ),
    );
  try {
    for (let i = 0; i < 2; i++) {
      const user = await request(
        "auth/signup",
        {
          firstName: "Correction",
          lastName: "Test",
          email: `correction-${randomUUID()}@example.test`,
          password: "correction-test-password-123",
        },
        "",
      );
      assert.equal(user.status, 201);
      users.push(user.body.id);
      if (i === 0) cookie = user.cookie!;
      else foreign = user.cookie!;
    }
    bank = await createAccount("Original source", "1000");
    second = await createAccount("New source", "500");
    account = await createAccount("Portfolio", "20", "INVESTMENT");
    const reference = await app.get(InstrumentsService).remember({
      symbol: `COR${randomUUID().replaceAll("-", "").slice(0, 8)}/EUR`,
      name: "Correction instrument",
      assetType: "CRYPTO",
      currency: "EUR",
      exchange: "Binance",
      mic: "",
      timeZone: "UTC",
      isin: null,
    });
    instruments.push(reference.id);
    const createdAsset = await request("assets", {
      instrumentId: reference.id,
    });
    assert.equal(createdAsset.status, 201);
    asset = createdAsset.body.id;

    await suite.test(
      "corrects a purchase, source and fees, rebuilds subsequent snapshots and retains originals",
      async () => {
        const original = await request("investments", buy());
        assert.equal(original.status, 201);
        buyId = original.body.id;
        originalFundingId = original.body.fundingTransactionId;
        const later = await request("transactions", {
          type: "TRANSFER",
          sourceAccountId: bank,
          destinationAccountId: second,
          amount: "20",
          currency: "EUR",
          occurredAt: at(1800000),
          clientRequestId: randomUUID(),
        });
        assert.equal(later.status, 201);
        assert.equal(later.body.sourceBalanceAfter, "877.75");
        const correction = await request(
          "investments",
          buy({
            replacesId: buyId,
            sourceAccountId: second,
            quantity: "12",
            totalAmount: "120",
            fee: "3",
          }),
        );
        assert.equal(correction.status, 201);
        correctedId = correction.body.id;
        assert.equal(correction.body.replacesId, buyId);
        assert.equal(correction.body.balanceAfter, "20");
        assert.equal(correction.body.executedAt, original.body.executedAt);
        const old = await db.investmentTransaction.findUniqueOrThrow({
          where: { id: buyId },
        });
        const funding = await db.transaction.findUniqueOrThrow({
          where: { id: originalFundingId },
        });
        assert.ok(old.voidedAt);
        assert.equal(funding.voidedAt?.getTime(), old.voidedAt?.getTime());
        assert.equal(old.totalAmount.toFixed(), "100");
        assert.equal(old.fee.toFixed(), "2.25");
        const newFunding = await db.transaction.findUniqueOrThrow({
          where: { id: correction.body.fundingTransactionId },
        });
        assert.equal(newFunding.replacesId, originalFundingId);
        assert.equal(newFunding.amount.toFixed(), "123");
        assert.equal(newFunding.sourceBalanceAfter?.toFixed(), "377");
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: later.body.id },
            })
          ).sourceBalanceAfter?.toFixed(),
          "980",
        );
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: later.body.id },
            })
          ).destinationBalanceAfter?.toFixed(),
          "397",
        );
        assert.equal((await balances())[bank], "980");
        assert.equal((await balances())[second], "397");
        const value = (await request(`accounts/${account}/portfolio`)).body;
        assert.equal(value.positions[0].quantity, "12");
        assert.equal(value.positions[0].costBasis, "123");
        const history = (await request(`accounts/${account}/history`)).body;
        assert.equal(history.entries.length, 1);
        assert.equal(history.entries[0].funding.sourceAccountId, second);
        assert.equal(history.entries[0].transaction.id, correctedId);
        const analytics = (await request("analytics")).body;
        assert.equal(analytics.income, "0");
        assert.equal(analytics.expenses, "0");
      },
    );

    await suite.test(
      "exact correction retries are idempotent and changed retry payloads conflict",
      async () => {
        const input = buy({
          replacesId: correctedId,
          sourceAccountId: second,
          quantity: "12",
          totalAmount: "120",
          fee: "4",
        });
        const correction = await request("investments", input);
        assert.equal(correction.status, 201);
        assert.equal(
          (await request("investments", input)).body.id,
          correction.body.id,
        );
        assert.equal(
          (await request("investments", { ...input, fee: "5" })).status,
          409,
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { userId: users[0], voidedAt: null },
          }),
          1,
        );
        correctedId = correction.body.id;
        assert.equal((await balances())[second], "396");
      },
    );

    await suite.test(
      "loads owned active activity details without exposing the funding relation or changing the ledger",
      async () => {
        const before = (
          await db.user.findUniqueOrThrow({ where: { id: users[0] } })
        ).ledgerVersion;
        const result = await request(`investments/${correctedId}`);
        assert.equal(result.status, 200);
        assert.equal(result.body.sourceAccountId, second);
        assert.equal(result.body.quantity, "12");
        assert.equal(result.body.pricePerUnit, "10");
        assert.equal(result.body.fee, "4");
        assert.equal(result.body.executedAt, at(0));
        assert.equal(result.body.fundingTransaction, undefined);
        assert.equal(
          (await request(`investments/${correctedId}`, undefined, foreign))
            .status,
          404,
        );
        assert.equal(
          (await request(`investments/${correctedId}`, undefined, "")).status,
          401,
        );
        assert.equal((await request(`investments/${buyId}`)).status, 404);
        assert.equal((await request("investments/missing")).status, 404);
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: users[0] } }))
            .ledgerVersion,
          before,
        );
      },
    );
    await suite.test(
      "rejects foreign and invalid associations without voiding the original",
      async () => {
        const foreignSource = await createAccount(
          "Foreign source",
          "100",
          "BANK",
          foreign,
        );
        const foreignAsset = await request(
          "assets",
          { instrumentId: reference.id },
          foreign,
        );
        const before = await balances();
        const count = await db.investmentTransaction.count({
          where: { userId: users[0] },
        });
        const input = buy({
          replacesId: correctedId,
          sourceAccountId: second,
          quantity: "12",
          totalAmount: "120",
          fee: "4",
        });
        assert.equal((await request("investments", input, "")).status, 401);
        assert.equal(
          (await request("investments", input, foreign)).status,
          404,
        );
        assert.equal(
          (
            await request("investments", {
              ...input,
              sourceAccountId: foreignSource,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request("investments", {
              ...input,
              assetId: foreignAsset.body.id,
            })
          ).status,
          404,
        );
        assert.equal(
          (await request("investments", { ...input, replacesId: buyId }))
            .status,
          404,
        );
        assert.equal(
          (await request("investments", { ...input, replacesId: "missing" }))
            .status,
          404,
        );
        assert.equal(
          (await request("investments", { ...input, ledgerOrderAt: at(0) }))
            .status,
          400,
        );
        assert.equal(
          (await request("investments", { ...input, userId: users[1] })).status,
          400,
        );
        const different = await createAccount(
          "Different portfolio",
          "0",
          "INVESTMENT",
        );
        assert.equal(
          (await request("investments", { ...input, accountId: different }))
            .status,
          400,
        );
        assert.equal(
          await db.investmentTransaction.count({ where: { userId: users[0] } }),
          count,
        );
        for (const [id, balance] of Object.entries(before))
          assert.equal((await balances())[id], balance);
        assert.equal(
          (
            await db.investmentTransaction.findUniqueOrThrow({
              where: { id: correctedId },
            })
          ).voidedAt,
          null,
        );
      },
    );

    await suite.test(
      "rolls back purchase/sale/time edits that leave subsequent sales uncovered",
      async () => {
        const sale = await request("investments", {
          accountId: account,
          assetId: asset,
          type: "SELL",
          quantity: "5",
          pricePerUnit: "15",
          totalAmount: "75",
          fee: "1",
          currency: "EUR",
          executedAt: at(900000),
          clientRequestId: randomUUID(),
        });
        assert.equal(sale.status, 201);
        saleId = sale.body.id;
        const before = await balances();
        const count = await db.investmentTransaction.count({
          where: { userId: users[0] },
        });
        for (const extra of [
          { quantity: "4", totalAmount: "40" },
          { executedAt: at(1200000) },
        ]) {
          const result = await request(
            "investments",
            buy({
              replacesId: correctedId,
              sourceAccountId: second,
              quantity: "12",
              totalAmount: "120",
              fee: "4",
              ...extra,
            }),
          );
          assert.equal(result.status, 400);
          assert.equal(result.body.code, "INSUFFICIENT_HOLDINGS");
        }
        const invalidSale = await request("investments", {
          accountId: account,
          replacesId: saleId,
          assetId: asset,
          type: "SELL",
          quantity: "13",
          pricePerUnit: "15",
          totalAmount: "195",
          currency: "EUR",
          executedAt: at(900000),
          clientRequestId: randomUUID(),
        });
        assert.equal(invalidSale.status, 400);
        assert.equal(
          await db.investmentTransaction.count({ where: { userId: users[0] } }),
          count,
        );
        assert.deepEqual(await balances(), before);
        for (const id of [saleId, correctedId])
          assert.equal(
            (
              await db.investmentTransaction.findUniqueOrThrow({
                where: { id },
              })
            ).voidedAt,
            null,
          );
      },
    );

    await suite.test(
      "corrects a sale and recalculates cash, quantity, cost basis and realized profit",
      async () => {
        const result = await request("investments", {
          accountId: account,
          replacesId: saleId,
          assetId: asset,
          type: "SELL",
          quantity: "6",
          pricePerUnit: "15",
          totalAmount: "90",
          fee: "2",
          currency: "EUR",
          executedAt: at(900000),
          clientRequestId: randomUUID(),
        });
        assert.equal(result.status, 201);
        assert.equal(result.body.fundingTransactionId, null);
        const value = (await request(`accounts/${account}/portfolio`)).body;
        assert.equal(value.cashBalance, "108");
        assert.equal(value.positions[0].quantity, "6");
        assert.equal(value.positions[0].costBasis, "62");
        assert.equal(value.positions[0].realizedGain, "26");
      },
    );

    await suite.test(
      "preserves ordering for an edited buy and sale at the exact same timestamp",
      async () => {
        const same = await createAccount(
          "Same-time portfolio",
          "0",
          "INVESTMENT",
        );
        const original = await request(
          "investments",
          buy({
            accountId: same,
            quantity: "2",
            totalAmount: "20",
            fee: "0",
            executedAt: at(2000000),
          }),
        );
        assert.equal(original.status, 201, JSON.stringify(original.body));
        const sale = await request("investments", {
          accountId: same,
          assetId: asset,
          type: "SELL",
          quantity: "1",
          pricePerUnit: "15",
          totalAmount: "15",
          currency: "EUR",
          executedAt: at(2000000),
          clientRequestId: randomUUID(),
        });
        assert.equal(sale.status, 201, JSON.stringify(sale.body));
        const corrected = await request(
          "investments",
          buy({
            replacesId: original.body.id,
            accountId: same,
            quantity: "3",
            totalAmount: "30",
            fee: "2",
            executedAt: at(2000000),
          }),
        );
        assert.equal(corrected.status, 201, JSON.stringify(corrected.body));
        assert.equal(corrected.body.ledgerOrderAt, original.body.createdAt);
        assert.ok(
          Date.parse(corrected.body.createdAt) >
            Date.parse(sale.body.createdAt),
        );
        const history = (await request(`accounts/${same}/history`)).body;
        assert.deepEqual(
          history.entries.map((e: { id: string }) => e.id),
          [sale.body.id, corrected.body.id],
        );
        assert.equal(
          (await request(`accounts/${same}/portfolio`)).body.positions[0]
            .quantity,
          "2",
        );
      },
    );

    await suite.test(
      "concurrent corrections cannot replace the same activity twice",
      async () => {
        const target = await createAccount(
          "Concurrent portfolio",
          "0",
          "INVESTMENT",
        );
        const original = await request(
          "investments",
          buy({ accountId: target }),
        );
        assert.equal(original.status, 201, JSON.stringify(original.body));
        const results = await Promise.all([
          request(
            "investments",
            buy({ accountId: target, replacesId: original.body.id, fee: "3" }),
          ),
          request(
            "investments",
            buy({ accountId: target, replacesId: original.body.id, fee: "4" }),
          ),
        ]);
        assert.deepEqual(
          results.map((r) => r.status).sort(),
          [201, 404],
          JSON.stringify(
            results.map((r) => ({ status: r.status, body: r.body })),
          ),
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { accountId: target, voidedAt: null },
          }),
          1,
        );
        assert.equal(
          await db.transaction.count({
            where: { destinationAccountId: target, voidedAt: null },
          }),
          1,
        );
      },
    );

    await suite.test(
      "supports correction of deposit, withdrawal, dividend and fee entries",
      async () => {
        for (const type of ["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "FEE"]) {
          const target = await createAccount(
            `${type} portfolio`,
            "100",
            "INVESTMENT",
          );
          const input = {
            accountId: target,
            sourceAccountId: type === "DEPOSIT" ? bank : null,
            assetId: type === "DIVIDEND" ? asset : null,
            type,
            totalAmount: "10",
            currency: "EUR",
            executedAt: at(0),
            clientRequestId: randomUUID(),
          };
          const original = await request("investments", input);
          assert.equal(original.status, 201);
          const result = await request("investments", {
            ...input,
            replacesId: original.body.id,
            totalAmount: "15",
            clientRequestId: randomUUID(),
          });
          assert.equal(result.status, 201);
          assert.equal(
            result.body.balanceAfter,
            type === "DEPOSIT" || type === "DIVIDEND" ? "115" : "85",
          );
          assert.equal(
            (
              await db.investmentTransaction.findUniqueOrThrow({
                where: { id: original.body.id },
              })
            ).totalAmount.toFixed(),
            "10",
          );
        }
      },
    );
  } finally {
    await db.investmentTransaction.updateMany({
      where: { userId: { in: users } },
      data: { replacesId: null },
    });
    await db.investmentTransaction.deleteMany({
      where: { userId: { in: users } },
    });
    await db.transaction.updateMany({
      where: { userId: { in: users } },
      data: { replacesId: null },
    });
    await db.transaction.deleteMany({ where: { userId: { in: users } } });
    await db.asset.deleteMany({ where: { userId: { in: users } } });
    await db.account.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: instruments } } });
    await app.close();
  }
});
