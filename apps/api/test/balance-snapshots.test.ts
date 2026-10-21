import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (new URL(process.env.DATABASE_URL).pathname !== "/opulya_test")
  throw new Error("Dedicated test database required");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { InstrumentsService } = await import("../src/instruments.js");

test("stored balance snapshots and optional balance history", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const users: string[] = [];
  const instrumentIds: string[] = [];
  let cookie = "",
    foreign = "",
    accountId = "",
    destinationId = "",
    incomeId = "",
    incomeCategory = "",
    expenseCategory = "",
    expenseId = "",
    transferId = "";
  const base = Date.now();
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
  const account = async (
    name: string,
    initialBalance: string,
    recordInitialBalance = false,
    type = "BANK",
  ) => {
    const result = await request("accounts", {
      name,
      type,
      currency: "EUR",
      initialBalance,
      recordInitialBalance,
    });
    assert.equal(result.status, 201);
    return result.body.id as string;
  };
  const entry = (
    type: string,
    amount: string,
    source: string | null,
    destination: string | null,
    offset: number,
  ) => ({
    type,
    amount,
    sourceAccountId: source,
    destinationAccountId: destination,
    categoryId:
      type === "INCOME"
        ? incomeCategory
        : type === "EXPENSE"
          ? expenseCategory
          : null,
    currency: "EUR",
    occurredAt: at(offset),
    clientRequestId: randomUUID(),
  });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await request(
        "auth/signup",
        {
          firstName: "Balance",
          lastName: "Test",
          email: `balances-${randomUUID()}@example.test`,
          password: "snapshot-test-password-123",
        },
        "",
      );
      assert.equal(result.status, 201);
      users.push(result.body.id);
      if (i === 0) cookie = result.cookie!;
      else foreign = result.cookie!;
    }
    incomeCategory = (
      await request("categories", { name: "Income", type: "INCOME" })
    ).body.id;
    expenseCategory = (
      await request("categories", { name: "Expenses", type: "EXPENSE" })
    ).body.id;
    await suite.test(
      "opening balance can be a baseline or a visible non-income transaction, never both",
      async () => {
        accountId = await account("Baseline", "100");
        destinationId = await account("Destination", "20");
        assert.equal(
          await db.transaction.count({ where: { userId: users[0] } }),
          0,
        );
        for (const initialBalance of ["200", "-25", "0"]) {
          const id = await account("Recorded opening", initialBalance, true);
          assert.equal(
            (
              await db.account.findUniqueOrThrow({ where: { id } })
            ).initialBalance.toFixed(),
            "0",
          );
          const opening = await db.transaction
            .findFirstOrThrow({
              where: { destinationAccountId: id, isOpeningBalance: true },
            })
            .catch(() =>
              db.transaction.findFirstOrThrow({
                where: { sourceAccountId: id, isOpeningBalance: true },
              }),
            );
          assert.equal(opening.type, "ADJUSTMENT");
          assert.equal(
            (
              opening.sourceBalanceAfter ?? opening.destinationBalanceAfter
            )?.toFixed(),
            initialBalance,
          );
          const history = await request(`accounts/${id}/history`);
          assert.equal(history.body.closing, initialBalance);
          assert.equal(history.body.entries.length, 1);
          assert.equal(history.body.income, "0");
          assert.equal(history.body.expenses, "0");
        }
      },
    );
    await suite.test(
      "saves precise balance-after values for income, expense and both transfer accounts",
      async () => {
        const income = await request(
          "transactions",
          entry("INCOME", "50", null, accountId, -80000),
        );
        incomeId = income.body.id;
        assert.equal(income.body.destinationBalanceAfter, "150");
        const expense = await request(
          "transactions",
          entry("EXPENSE", "25", accountId, null, -60000),
        );
        assert.equal(expense.status, 201, JSON.stringify(expense.body));
        expenseId = expense.body.id;
        assert.equal(expense.body.sourceBalanceAfter, "125");
        const transfer = await request(
          "transactions",
          entry("TRANSFER", "10", accountId, destinationId, -40000),
        );
        transferId = transfer.body.id;
        assert.equal(transfer.body.sourceBalanceAfter, "115");
        assert.equal(transfer.body.destinationBalanceAfter, "30");
        const stored = await db.transaction.findUniqueOrThrow({
          where: { id: transferId },
        });
        assert.equal(stored.sourceBalanceAfter?.toFixed(), "115");
        assert.equal(stored.destinationBalanceAfter?.toFixed(), "30");
      },
    );
    await suite.test(
      "backdating and correcting transactions rebuild subsequent stored balances",
      async () => {
        await request(
          "transactions",
          entry("INCOME", "5", null, accountId, -100000),
        );
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({ where: { id: expenseId } })
          ).sourceBalanceAfter?.toFixed(),
          "130",
        );
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: transferId },
            })
          ).sourceBalanceAfter?.toFixed(),
          "120",
        );
        const correction = await request("transactions", {
          ...entry("INCOME", "40", null, accountId, -80000),
          replacesId: incomeId,
        });
        assert.equal(correction.status, 201);
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: transferId },
            })
          ).sourceBalanceAfter?.toFixed(),
          "110",
        );
        assert.ok(
          (await db.transaction.findUniqueOrThrow({ where: { id: incomeId } }))
            .voidedAt,
        );
      },
    );
    await suite.test(
      "unchecked balance updates stay out of history while remaining in the ledger and later snapshots",
      async () => {
        const input = {
          balance: "400",
          expectedBalance: "110",
          recordTransaction: false,
          clientRequestId: randomUUID(),
        };
        const result = await request(`accounts/${accountId}/balance`, input);
        assert.equal(result.status, 201);
        assert.equal(result.body.destinationBalanceAfter, "400");
        assert.equal(
          (await request(`accounts/${accountId}/balance`, input)).body.id,
          result.body.id,
        );
        assert.equal(
          (
            await request(`accounts/${accountId}/balance`, {
              ...input,
              recordTransaction: true,
            })
          ).status,
          409,
        );
        const stored = await db.transaction.findUniqueOrThrow({
          where: { id: result.body.id },
        });
        assert.equal(stored.visibleInHistory, false);
        const history = await request(`accounts/${accountId}/history`);
        assert.equal(history.body.closing, "400");
        assert.ok(
          !history.body.entries.some(
            (e: { id: string }) => e.id === result.body.id,
          ),
        );
        assert.ok(
          !(await request("transactions")).body.some(
            (e: { id: string }) => e.id === result.body.id,
          ),
        );
        const expense = await request("transactions", {
          ...entry("EXPENSE", "20", accountId, null, 2000),
          occurredAt: new Date(
            Date.parse(result.body.occurredAt) + 1,
          ).toISOString(),
        });
        assert.equal(expense.body.sourceBalanceAfter, "380");
        assert.equal(
          (await request(`accounts/${accountId}/history`)).body.closing,
          "380",
        );
        assert.equal(
          (
            await request(
              `accounts/${accountId}/balance`,
              { ...input, clientRequestId: randomUUID() },
              foreign,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(`accounts/${accountId}/balance`, {
              ...input,
              recordTransaction: "false",
            })
          ).status,
          400,
        );
      },
    );
    await suite.test(
      "visible adjustments remain in history and voiding rebuilds subsequent snapshots",
      async () => {
        const adjustment = await request(`accounts/${accountId}/balance`, {
          balance: "500",
          expectedBalance: "380",
          recordTransaction: true,
          clientRequestId: randomUUID(),
        });
        assert.equal(adjustment.status, 201);
        assert.ok(
          (await request("transactions")).body.some(
            (row: { id: string }) => row.id === adjustment.body.id,
          ),
        );
        assert.equal(
          (await request(`transactions/${expenseId}/void`, {})).status,
          201,
        );
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: adjustment.body.id },
            })
          ).destinationBalanceAfter?.toFixed(),
          "525",
        );
        assert.equal(
          (await request(`accounts/${accountId}/history`)).body.closing,
          "525",
        );
      },
    );
    await suite.test(
      "investment activity and linked funding store their combined cash balances and rebuild on void",
      async () => {
        const source = await account("Investment source", "1000");
        const investment = await account(
          "Portfolio",
          "20",
          false,
          "INVESTMENT",
        );
        const reference = await app.get(InstrumentsService).remember({
          symbol: `BC${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}/EUR`,
          name: "Bitcoin",
          assetType: "CRYPTO",
          currency: "EUR",
          exchange: "Binance",
          mic: "",
          timeZone: "UTC",
          isin: null,
        });
        instrumentIds.push(reference.id);
        const asset = await request("assets", { instrumentId: reference.id });
        const buy = await request("investments", {
          accountId: investment,
          sourceAccountId: source,
          assetId: asset.body.id,
          type: "BUY",
          quantity: "0.01",
          pricePerUnit: "80000",
          totalAmount: "800",
          fee: "50",
          currency: "EUR",
          executedAt: at(-10000),
          clientRequestId: randomUUID(),
        });
        assert.equal(buy.status, 201);
        assert.equal(buy.body.balanceAfter, "20");
        const funding = await db.transaction.findUniqueOrThrow({
          where: { id: buy.body.fundingTransactionId },
        });
        assert.equal(funding.sourceBalanceAfter?.toFixed(), "150");
        assert.equal(funding.destinationBalanceAfter?.toFixed(), "20");
        const deposit = await request("investments", {
          accountId: investment,
          sourceAccountId: source,
          type: "DEPOSIT",
          totalAmount: "50",
          currency: "EUR",
          executedAt: at(-5000),
          clientRequestId: randomUUID(),
        });
        assert.equal(deposit.status, 201);
        assert.equal(deposit.body.balanceAfter, "70");
        assert.equal(
          (await request(`investments/${buy.body.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: deposit.body.fundingTransactionId },
            })
          ).sourceBalanceAfter?.toFixed(),
          "950",
        );
      },
    );
    await suite.test(
      "automatic portfolio polls cannot keep an idle session alive",
      async () => {
        const portfolio = await db.account.findFirstOrThrow({
          where: { userId: users[0], type: "INVESTMENT" },
        });
        const session = await db.session.findFirstOrThrow({
          where: { userId: users[0] },
          orderBy: { createdAt: "desc" },
        });
        const seen = new Date(Date.now() - 60_000);
        await db.session.update({
          where: { id: session.id },
          data: { lastSeenAt: seen },
        });
        const response = await fetch(
          `${url}/api/accounts/${portfolio.id}/portfolio`,
          { headers: { Cookie: cookie, "X-Opulya-Poll": "1" } },
        );
        assert.equal(response.status, 200);
        assert.equal(
          (
            await db.session.findUniqueOrThrow({ where: { id: session.id } })
          ).lastSeenAt.getTime(),
          seen.getTime(),
        );
        await db.session.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(0) },
        });
        const expired = await fetch(
          `${url}/api/accounts/${portfolio.id}/portfolio`,
          { headers: { Cookie: cookie, "X-Opulya-Poll": "1" } },
        );
        assert.equal(expired.status, 401);
      },
    );
  } finally {
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
    await db.category.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    await app.close();
  }
});
