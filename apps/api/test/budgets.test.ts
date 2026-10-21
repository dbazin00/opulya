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
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");

test("monthly budgets REST integration", async (suite) => {
  const app = await bootstrap(0);
  const db = app.get(Database);
  const url = await app.getUrl();
  const users: string[] = [];
  let cookie = "",
    foreignCookie = "",
    root = "",
    child = "",
    leaf = "",
    account = "";
  const request = async (
    path: string,
    body?: unknown,
    method = "POST",
    token = cookie,
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : method,
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
  const read = async (
    month = "2026-03",
    currency = "EUR",
    type = "EXPENSE",
    token = cookie,
  ) =>
    request(
      `budgets?month=${month}&currency=${currency}&type=${type}`,
      undefined,
      "GET",
      token,
    );
  const save = (
    categoryId: string,
    amount: string | null,
    month = "2026-03",
    scope = "RECURRING",
    currency = "EUR",
    token = cookie,
  ) =>
    request(
      "budgets",
      { categoryId, amount, month, scope, currency },
      "POST",
      token,
    );
  const category = async (
    name: string,
    parentId: string | null = null,
    type = "EXPENSE",
  ) => {
    const result = await request("categories", { name, parentId, type });
    assert.equal(result.status, 201);
    return result.body.id as string;
  };
  const expense = (
    amount: string,
    occurredAt: string,
    categoryId = leaf,
    currency = "EUR",
    replacesId?: string,
  ) =>
    request("transactions", {
      type: "EXPENSE",
      sourceAccountId: account,
      categoryId,
      currency,
      amount,
      occurredAt,
      clientRequestId: randomUUID(),
      ...(replacesId ? { replacesId } : {}),
    });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await request("auth/signup", {
        firstName: "Budget",
        lastName: "Test",
        email: `budget-${randomUUID()}@example.test`,
        password: "budget-test-password-123",
      });
      assert.equal(result.status, 201);
      users.push(result.body.id);
      if (i === 0) cookie = result.cookie!;
      else foreignCookie = result.cookie!;
    }
    root = await category("Food");
    child = await category("Restaurants", root);
    leaf = await category("Fast food", child);
    const bank = await request("accounts", {
      name: "Bank",
      type: "BANK",
      currency: "EUR",
      initialBalance: "1000",
    });
    assert.equal(bank.status, 201);
    account = bank.body.id;

    await suite.test(
      "requires authentication and prevents IDOR and userId injection",
      async () => {
        assert.equal((await read("2026-03", "EUR", "EXPENSE", "")).status, 401);
        assert.equal(
          (
            await save(
              root,
              "100",
              "2026-03",
              "RECURRING",
              "EUR",
              foreignCookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "budgets/override",
              { categoryId: root, month: "2026-03", currency: "EUR" },
              "DELETE",
              foreignCookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request("budgets", {
              categoryId: root,
              month: "2026-03",
              currency: "EUR",
              scope: "MONTH",
              amount: "100",
              userId: users[1],
            })
          ).status,
          400,
        );
        assert.equal((await save("missing", "100")).status, 404);
      },
    );
    await suite.test(
      "versions repeating amounts and isolates monthly customizations",
      async () => {
        assert.equal((await save(root, "100")).status, 201);
        assert.equal((await save(root, "200", "2026-06")).status, 201);
        assert.equal((await save(root, "150", "2026-04", "MONTH")).status, 201);
        for (const [month, expected] of [
          ["2026-02", "0"],
          ["2026-03", "100"],
          ["2026-04", "150"],
          ["2026-05", "100"],
          ["2026-06", "200"],
          ["2027-01", "200"],
        ])
          assert.equal((await read(month)).body.planned, expected);
        assert.equal(
          (await read("2026-03", "EUR", "EXPENSE", foreignCookie)).body.rows
            .length,
          0,
        );
      },
    );
    await suite.test(
      "calculates nested actuals using local month boundaries and precise decimals",
      async () => {
        for (const [amount, date] of [
          ["0.1", "2026-02-28T23:00:00.000Z"],
          ["0.2", "2026-03-31T21:59:59.999Z"],
          ["50", "2026-02-28T22:59:59.999Z"],
          ["50", "2026-03-31T22:00:00.000Z"],
        ])
          assert.equal((await expense(amount!, date!)).status, 201);
        assert.equal((await save(leaf, "40")).status, 201);
        const result = (await read()).body;
        assert.equal(
          result.rows.find((r: { categoryId: string }) => r.categoryId === root)
            .actual,
          "0.3",
        );
        assert.equal(
          result.rows.find(
            (r: { categoryId: string }) => r.categoryId === child,
          ).actual,
          "0.3",
        );
        assert.equal(result.planned, "100");
        assert.equal(result.actual, "0.3");
        assert.equal(result.remaining, "99.7");
      },
    );
    await suite.test(
      "reflects backdated insertions, corrections and voiding immediately",
      async () => {
        const entry = await expense("10", "2026-03-15T12:00:00.000Z");
        assert.equal(entry.status, 201);
        assert.equal((await read()).body.actual, "10.3");
        const correction = await expense(
          "20",
          "2026-03-15T12:00:00.000Z",
          leaf,
          "EUR",
          entry.body.id,
        );
        assert.equal(correction.status, 201);
        assert.equal((await read()).body.actual, "20.3");
        assert.equal(
          (await request(`transactions/${correction.body.id}/void`, {})).status,
          201,
        );
        assert.equal((await read()).body.actual, "0.3");
      },
    );
    await suite.test(
      "excludes transfers, opening balances and income from spending",
      async () => {
        const destination = await request("accounts", {
          name: "Cash",
          type: "CASH",
          currency: "EUR",
          initialBalance: "10",
          recordInitialBalance: true,
        });
        assert.equal(destination.status, 201);
        const transfer = await request("transactions", {
          type: "TRANSFER",
          sourceAccountId: account,
          destinationAccountId: destination.body.id,
          currency: "EUR",
          amount: "50",
          occurredAt: "2026-03-15T12:00:00.000Z",
          clientRequestId: randomUUID(),
        });
        assert.equal(transfer.status, 201);
        const salary = await category("Salary", null, "INCOME");
        assert.equal((await save(salary, "1000")).status, 201);
        assert.equal(
          (
            await request("transactions", {
              type: "INCOME",
              destinationAccountId: account,
              categoryId: salary,
              currency: "EUR",
              amount: "900",
              occurredAt: "2026-03-15T12:00:00.000Z",
              clientRequestId: randomUUID(),
            })
          ).status,
          201,
        );
        assert.equal((await read()).body.actual, "0.3");
        assert.equal(
          (await read("2026-03", "EUR", "INCOME")).body.actual,
          "900",
        );
      },
    );
    await suite.test("separates currencies without conversion", async () => {
      assert.equal(
        (await save(root, "700", "2026-03", "RECURRING", "USD")).status,
        201,
      );
      const result = (await read("2026-03", "USD")).body;
      assert.equal(result.planned, "700");
      assert.equal(result.actual, "0");
      assert.equal((await read()).body.planned, "100");
    });
    await suite.test(
      "supports disabling one month, resetting and stopping future repetition",
      async () => {
        assert.equal((await save(root, null, "2026-04", "MONTH")).status, 201);
        assert.equal((await read("2026-04")).body.planned, "40");
        assert.equal(
          (
            await request(
              "budgets/override",
              { categoryId: root, month: "2026-04", currency: "EUR" },
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal((await read("2026-04")).body.planned, "100");
        assert.equal((await save(root, null, "2026-07")).status, 201);
        assert.equal((await read("2026-08")).body.planned, "40");
        assert.equal((await read("2026-06")).body.planned, "200");
        assert.equal((await save(root, "0", "2026-09", "MONTH")).status, 201);
        assert.equal((await read("2026-09")).body.planned, "0");
        assert.equal((await read("2026-03")).body.planned, "100");
      },
    );
    await suite.test(
      "validates input, upserts without duplicate rules, and preserves category budget history",
      async () => {
        for (const amount of ["-1", "NaN", "1e2", "1.123456789"])
          assert.equal((await save(root, amount)).status, 400);
        assert.equal((await read("2026-13")).status, 400);
        assert.equal((await read("2026-03", "ZZZ")).status, 400);
        assert.equal((await save(root, "100")).status, 201);
        assert.equal(
          await db.budget.count({
            where: {
              categoryId: root,
              currency: "EUR",
              month: "2026-03",
              scope: "RECURRING",
            },
          }),
          1,
        );
        const unused = await category("Only budget");
        assert.equal((await save(unused, "25")).status, 201);
        assert.equal(
          (await request(`categories/${unused}`, {}, "DELETE")).status,
          409,
        );
        assert.equal(
          (await request(`categories/${unused}/archive`, {})).status,
          201,
        );
        assert.equal((await save(unused, "30")).status, 400);
        assert.equal((await save(unused, null, "2026-04")).status, 201);
        assert.ok(
          (await read()).body.rows.find(
            (r: { categoryId: string; amount: string }) =>
              r.categoryId === unused && r.amount === "25",
          ),
        );
      },
    );
  } finally {
    const where = { userId: { in: users } };
    await db.budget.deleteMany({ where });
    await db.transaction.deleteMany({
      where: { ...where, replacesId: { not: null } },
    });
    await db.transaction.deleteMany({ where });
    await db.category.updateMany({ where, data: { parentId: null } });
    await db.category.deleteMany({ where });
    await db.account.deleteMany({ where });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
