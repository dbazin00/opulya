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
    await suite.test(
      "permanent deletion is owner-scoped and rejects unexpected input",
      async () => {
        const input = { categoryId: root, currency: "EUR" };
        const before = await db.budget.count({ where: { categoryId: root } });
        assert.equal(
          (await request("budgets", input, "DELETE", "")).status,
          401,
        );
        assert.equal(
          (await request("budgets", input, "DELETE", foreignCookie)).status,
          404,
        );
        for (const extra of [
          { userId: users[0] },
          { month: "2026-03" },
          { currency: "ZZZ" },
        ]) {
          assert.equal(
            (await request("budgets", { ...input, ...extra }, "DELETE")).status,
            400,
          );
        }
        assert.equal(
          (
            await request(
              "budgets",
              { categoryId: randomUUID(), currency: "EUR" },
              "DELETE",
            )
          ).status,
          404,
        );
        assert.equal(
          await db.budget.count({ where: { categoryId: root } }),
          before,
        );
      },
    );
    await suite.test(
      "permanent deletion removes all category rules in one currency without changing finances or child budgets",
      async () => {
        const where = { userId: users[0]! };
        const transactions = await db.transaction.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const categories = await db.category.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const accounts = await db.account.findMany({
          where,
          orderBy: { id: "asc" },
        });
        const retainedBudgets = await db.budget.findMany({
          where: { ...where, NOT: { categoryId: root, currency: "EUR" } },
          orderBy: { id: "asc" },
        });
        const input = { categoryId: root, currency: "EUR" };
        assert.equal((await request("budgets", input, "DELETE")).status, 200);
        assert.equal(
          await db.budget.count({ where: { ...input, ...where } }),
          0,
        );
        assert.equal(
          (await read()).body.rows.find(
            (r: { categoryId: string }) => r.categoryId === root,
          ).amount,
          null,
        );
        assert.equal(
          (await read("2026-09")).body.rows.find(
            (r: { categoryId: string }) => r.categoryId === root,
          ).amount,
          null,
        );
        assert.deepEqual(
          await db.budget.findMany({ where, orderBy: { id: "asc" } }),
          retainedBudgets,
        );
        assert.deepEqual(
          await db.transaction.findMany({ where, orderBy: { id: "asc" } }),
          transactions,
        );
        assert.deepEqual(
          await db.category.findMany({ where, orderBy: { id: "asc" } }),
          categories,
        );
        assert.deepEqual(
          await db.account.findMany({ where, orderBy: { id: "asc" } }),
          accounts,
        );
        assert.equal((await request("budgets", input, "DELETE")).status, 200);

        const archived = categories.find((c) => c.archivedAt);
        assert.ok(archived);
        assert.equal(
          (
            await request(
              "budgets",
              { categoryId: archived.id, currency: "EUR" },
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal(
          await db.budget.count({
            where: { ...where, categoryId: archived.id },
          }),
          0,
        );
        assert.ok(
          await db.category.findFirst({ where: { ...where, id: archived.id } }),
        );
      },
    );
    await suite.test(
      "per-asset goals track purchases and buying fees across accounts, with safe lifecycle operations",
      async () => {
        const userId = users[0]!;
        const asset = await db.asset.create({
          data: {
            userId,
            symbol: "IWDA.AS",
            name: "Budget ETF",
            assetType: "ETF",
            currency: "EUR",
          },
        });
        const unused = await db.asset.create({
          data: {
            userId,
            symbol: "BTC/EUR",
            name: "Budget coin",
            assetType: "CRYPTO",
            currency: "EUR",
          },
        });
        const dollarAsset = await db.asset.create({
          data: {
            userId,
            symbol: "TEST",
            name: "Dollar asset",
            assetType: "STOCK",
            currency: "USD",
          },
        });
        const foreignAsset = await db.asset.create({
          data: {
            userId: users[1]!,
            symbol: "IWDA.AS",
            name: "Private ETF",
            assetType: "ETF",
            currency: "EUR",
          },
        });
        const portfolio = await request("accounts", {
          name: "Portfolio",
          type: "INVESTMENT",
          currency: "EUR",
          initialBalance: "500",
        });
        const secondPortfolio = await request("accounts", {
          name: "Second portfolio",
          type: "INVESTMENT",
          currency: "EUR",
          initialBalance: "500",
        });
        assert.equal(portfolio.status, 201);
        assert.equal(secondPortfolio.status, 201);
        const input = {
          assetId: asset.id,
          month: "2026-03",
          currency: "EUR",
          scope: "RECURRING",
          amount: "1000",
        };
        assert.equal((await request("budgets", input)).status, 201);
        assert.equal(
          (await request("budgets", { ...input, assetId: foreignAsset.id }))
            .status,
          404,
        );
        assert.equal(
          (await request("budgets", input, "POST", foreignCookie)).status,
          404,
        );
        assert.equal(
          (await request("budgets", { ...input, currency: "USD" })).status,
          400,
        );
        assert.equal(
          (await request("budgets", { ...input, categoryId: child })).status,
          400,
        );
        assert.equal(
          (await request("budgets", { ...input, userId: users[1] })).status,
          400,
        );
        assert.equal(
          (
            await request(
              "budgets",
              { assetId: asset.id, currency: "EUR" },
              "DELETE",
              foreignCookie,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "budgets/override",
              { assetId: asset.id, currency: "EUR", month: "2026-03" },
              "DELETE",
              foreignCookie,
            )
          ).status,
          404,
        );
        const report = async (month = "2026-03", currency = "EUR") =>
          (await read(month, currency, "INVESTMENT")).body;
        assert.equal((await report()).planned, "1000");
        assert.equal(
          (await read("2026-03", "EUR", "INVESTMENT", foreignCookie)).body
            .planned,
          "0",
        );
        assert.ok(
          (await report()).rows.every(
            (r: { assetId: string }) =>
              r.assetId !== foreignAsset.id && r.assetId !== dollarAsset.id,
          ),
        );
        const buy = (extra: Record<string, unknown> = {}) =>
          request("investments", {
            accountId: portfolio.body.id,
            sourceAccountId: account,
            assetId: asset.id,
            type: "BUY",
            quantity: "10",
            pricePerUnit: "10",
            totalAmount: "100",
            fee: "2",
            currency: "EUR",
            executedAt: "2026-03-15T12:00:00Z",
            clientRequestId: randomUUID(),
            ...extra,
          });
        const first = await buy();
        const second = await buy({
          accountId: secondPortfolio.body.id,
          quantity: "20",
          totalAmount: "200",
          fee: "3",
          executedAt: "2026-03-16T12:00:00Z",
        });
        assert.equal(first.status, 201);
        assert.equal(second.status, 201);
        assert.equal((await report()).actual, "305");
        assert.equal((await report()).remaining, "695");
        // The linked funding transfers are not counted a second time.
        assert.equal((await report()).totalActual, "305");
        assert.equal(
          (
            await request("investments", {
              accountId: portfolio.body.id,
              assetId: asset.id,
              type: "SELL",
              quantity: "1",
              pricePerUnit: "20",
              totalAmount: "20",
              fee: "1",
              currency: "EUR",
              executedAt: "2026-03-20T12:00:00Z",
              clientRequestId: randomUUID(),
            })
          ).status,
          201,
        );
        for (const type of ["DEPOSIT", "DIVIDEND", "FEE", "WITHDRAWAL"]) {
          assert.equal(
            (
              await request("investments", {
                accountId: portfolio.body.id,
                ...(type === "DEPOSIT" ? { sourceAccountId: account } : {}),
                ...(type === "DIVIDEND" ? { assetId: asset.id } : {}),
                type,
                totalAmount: "1",
                currency: "EUR",
                executedAt: "2026-03-21T12:00:00Z",
                clientRequestId: randomUUID(),
              })
            ).status,
            201,
          );
        }
        assert.equal((await report()).actual, "305");
        const corrected = await buy({
          replacesId: first.body.id,
          quantity: "15",
          totalAmount: "150",
          fee: "4",
        });
        assert.equal(corrected.status, 201);
        assert.equal((await report()).actual, "357");
        assert.equal(
          (await request(`investments/${second.body.id}/void`, {})).status,
          201,
        );
        assert.equal((await report()).actual, "154");
        assert.equal(
          (
            await buy({
              quantity: "1",
              pricePerUnit: "5",
              totalAmount: "5",
              fee: "0.5",
              executedAt: "2026-02-28T23:00:00Z",
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await buy({
              quantity: "1",
              pricePerUnit: "7",
              totalAmount: "7",
              fee: "0.25",
              executedAt: "2026-03-31T22:00:00Z",
            })
          ).status,
          201,
        );
        assert.equal((await report()).actual, "159.5");
        assert.equal((await report("2026-04")).actual, "7.25");
        assert.equal(
          (await read("2026-03", "USD", "INVESTMENT")).body.totalActual,
          "0",
        );
        assert.ok(
          (await read()).body.rows.every(
            (r: { categoryId: unknown }) => typeof r.categoryId === "string",
          ),
        );
        assert.equal(
          (
            await request("budgets", {
              ...input,
              month: "2026-04",
              scope: "MONTH",
              amount: "200",
            })
          ).status,
          201,
        );
        assert.equal((await report("2026-04")).planned, "200");
        assert.equal((await report("2026-05")).planned, "1000");
        assert.equal(
          (
            await request(
              "budgets/override",
              { assetId: asset.id, currency: "EUR", month: "2026-04" },
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal((await report("2026-04")).planned, "1000");
        assert.equal(
          (
            await request("budgets", {
              ...input,
              month: "2026-05",
              amount: null,
            })
          ).status,
          201,
        );
        assert.equal((await report("2026-05")).count, 0);
        assert.equal((await report()).planned, "1000");
        const transactions = await db.investmentTransaction.count({
          where: { userId },
        });
        assert.equal(
          (
            await request(
              "budgets",
              { assetId: asset.id, currency: "EUR" },
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal((await report()).count, 0);
        assert.equal((await report()).totalActual, "159.5");
        assert.equal(
          await db.investmentTransaction.count({ where: { userId } }),
          transactions,
        );
        assert.ok(await db.asset.findUnique({ where: { id: asset.id } }));
        assert.equal(
          (await request("budgets", { ...input, assetId: unused.id })).status,
          201,
        );
        assert.equal(
          (await request(`assets/${unused.id}`, {}, "DELETE")).body.code,
          "ASSET_HAS_BUDGETS",
        );
        assert.equal(
          (await request("assets")).body.find(
            (a: { id: string }) => a.id === unused.id,
          ).canDelete,
          false,
        );
        assert.equal(
          (
            await request(
              "budgets",
              { assetId: unused.id, currency: "EUR" },
              "DELETE",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(`assets/${unused.id}`, {}, "DELETE")).status,
          200,
        );
      },
    );
  } finally {
    const where = { userId: { in: users } };
    await db.budget.deleteMany({ where });
    await db.investmentTransaction.deleteMany({
      where: { ...where, replacesId: { not: null } },
    });
    await db.investmentTransaction.deleteMany({ where });
    await db.transaction.deleteMany({
      where: { ...where, replacesId: { not: null } },
    });
    await db.transaction.deleteMany({ where });
    await db.category.updateMany({ where, data: { parentId: null } });
    await db.category.deleteMany({ where });
    await db.account.deleteMany({ where });
    await db.asset.deleteMany({ where });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
