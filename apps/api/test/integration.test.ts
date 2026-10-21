import { testDatabaseUrl } from "../../../packages/config/test-database.js";
import "dotenv/config";
import { completeTestSignup, signupRequestBody } from "./auth-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
process.env.OPULYA_TEST = "1";
process.env.NODE_ENV = "test";
process.env.EMAIL_TRANSPORT = "test";
process.env.MARKET_DATA_ENABLED = "false";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.WEB_ORIGIN = "http://localhost:3000";
if (!new URL(process.env.DATABASE_URL).pathname.endsWith("/opulya_test"))
  throw new Error("Integration tests require a dedicated opulya_test database");
const { bootstrap } = await import("../src/main.js");
const { Database } = await import("../src/db.js");
const { InstrumentsService } = await import("../src/instruments.js");
const { hashToken } = await import("../src/security.js");
type RecordData = Record<string, unknown>;
test("PostgreSQL REST integration", async (suite) => {
  const app = await bootstrap(0);
  const db = app.get(Database);
  const url = await app.getUrl();
  const userIds: string[] = [];
  const instrumentIds: string[] = [];
  let cookieA = "",
    cookieB = "",
    accountA = "",
    accountB = "",
    investmentAccount = "",
    assetId = "",
    incomeId = "",
    incomeCategory = "",
    expenseCategory = "",
    categoryA = "",
    categoryB = "";
  const suffix = randomUUID();
  const emailA = `integration-a-${suffix}@example.test`;
  const emailB = `integration-b-${suffix}@example.test`;
  const request = async (
    path: string,
    body?: unknown,
    cookie = cookieA,
    method = "POST",
    origin = "http://localhost:3000",
  ) => {
    const response = await fetch(`${url}/api/${path}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: origin,
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
    // Leave production limits intact while this long suite shares one loopback IP.
    if (!path.startsWith("auth/")) {
      const rate = response.headers.get("ratelimit") ?? "";
      const remaining = /(?:^|;)\s*r=(\d+)/.exec(rate)?.[1];
      const reset = /(?:^|;)\s*t=(\d+)/.exec(rate)?.[1];
      if (
        remaining !== undefined &&
        Number(remaining) < 10 &&
        reset !== undefined
      )
        await new Promise((resolve) =>
          setTimeout(resolve, (Number(reset) + 1) * 1000),
        );
    }
    return {
      status: response.status,
      body: (await response.json()) as RecordData,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      headers: response.headers,
    };
  };
  const date = "2026-09-15T12:00:00.000Z";
  const tx = (
    type: string,
    amount: string,
    sourceAccountId: string | null,
    destinationAccountId: string | null,
    extra: RecordData = {},
  ) => ({
    type,
    amount,
    sourceAccountId,
    destinationAccountId,
    categoryId:
      type === "INCOME"
        ? incomeCategory
        : type === "EXPENSE"
          ? expenseCategory
          : null,
    currency: "EUR",
    occurredAt: date,
    clientRequestId: randomUUID(),
    ...extra,
  });
  const fundingSetup = async (sourceType = "BANK") => {
    const source = await request("accounts", {
      name: "Funding source",
      type: sourceType,
      currency: "EUR",
      initialBalance: "1000",
    });
    const destination = await request("accounts", {
      name: "Funded portfolio",
      type: "INVESTMENT",
      currency: "EUR",
      initialBalance: "20",
    });
    assert.equal(source.status, 201);
    assert.equal(destination.status, 201);
    return {
      sourceId: source.body.id as string,
      accountId: destination.body.id as string,
      buy: {
        accountId: destination.body.id,
        sourceAccountId: source.body.id,
        assetId,
        type: "BUY",
        quantity: "10",
        pricePerUnit: "10",
        totalAmount: "100",
        fee: "2.25",
        currency: "EUR",
        executedAt: date,
        clientRequestId: randomUUID(),
      },
    };
  };
  try {
    await suite.test(
      "verified signup normalizes email, hashes password, and login returns a safe user and HttpOnly cookie",
      async () => {
        const result = await request(
          "auth/signup",
          {
            firstName: "Test",
            lastName: "One",
            email: `  ${emailA.toUpperCase()}  `,
            password: "integration-password-123",
            locale: "hr",
            timeZone: "Europe/Zagreb",
          },
          "",
        );
        assert.equal(result.status, 201);
        cookieA = result.cookie!;
        userIds.push(result.body.id as string);
        assert.equal(result.body.email, emailA);
        assert.equal(result.body.passwordHash, undefined);
        assert.match(result.headers.get("set-cookie")!, /HttpOnly/);
        assert.match(result.headers.get("set-cookie")!, /SameSite=Strict/);
        const session = await db.session.findFirstOrThrow({
          where: { userId: result.body.id as string },
        });
        const rawToken = cookieA.split("=")[1];
        assert.notEqual(session.tokenHash, rawToken);
        assert.equal(
          (
            await request(
              "auth/me",
              undefined,
              `opulya_session=${session.tokenHash}`,
            )
          ).status,
          401,
        );
        const user = await db.user.findUniqueOrThrow({
          where: { email: emailA },
        });
        assert.ok(user.passwordHash);
        assert.match(user.passwordHash, /^\$argon2id\$/);
        assert.equal(
          await db.category.count({ where: { userId: user.id } }),
          0,
        );
        assert.deepEqual((await request("categories")).body, []);
      },
    );
    await suite.test(
      "rejects role escalation and logs in with normalized email",
      async () => {
        const invalid = await request(
          "auth/signup",
          {
            firstName: "X",
            lastName: "Y",
            email: emailB,
            password: "integration-password-123",
            role: "ADMIN",
          },
          "",
        );
        assert.equal(invalid.status, 400);
        const b = await request(
          "auth/signup",
          {
            firstName: "Test",
            lastName: "Two",
            email: emailB,
            password: "integration-password-123",
          },
          "",
        );
        assert.equal(b.status, 201);
        cookieB = b.cookie!;
        userIds.push(b.body.id as string);
        const login = await request(
          "auth/login",
          { email: emailA.toUpperCase(), password: "integration-password-123" },
          "",
        );
        assert.equal(login.status, 201);
        cookieA = login.cookie!;
        assert.equal(
          (
            await request(
              "auth/login",
              { email: emailA, password: "wrong" },
              "",
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await request(
              "auth/login",
              { email: "missing@example.test", password: "wrong" },
              "",
            )
          ).status,
          401,
        );
      },
    );
    await suite.test(
      "requires authentication and rejects foreign origins",
      async () => {
        assert.equal((await request("accounts", undefined, "")).status, 401);
        assert.equal(
          (
            await request(
              "accounts",
              {
                name: "Test",
                type: "BANK",
                currency: "EUR",
                initialBalance: "0",
              },
              cookieA,
              "POST",
              "https://attacker.example",
            )
          ).status,
          403,
        );
      },
    );
    await suite.test(
      "re-login replaces the old cookie and enforces idle and absolute timeouts",
      async () => {
        const previousCookie = cookieA;
        const login = await request(
          "auth/login",
          { email: emailA, password: "integration-password-123" },
          previousCookie,
        );
        assert.equal(login.status, 201);
        cookieA = login.cookie!;
        assert.notEqual(cookieA, previousCookie);
        assert.equal(
          (await request("auth/me", undefined, previousCookie)).status,
          401,
        );
        assert.equal((await request("auth/me")).status, 200);
        const token = cookieA.split("=")[1];
        assert.ok(token);
        const session = await db.session.findFirstOrThrow({
          where: {
            userId: userIds[0],
            tokenHash: hashToken(token),
          },
        });
        await db.session.update({
          where: { id: session.id },
          data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
        });
        assert.equal((await request("auth/me")).status, 401);
        await db.session.update({
          where: { id: session.id },
          data: {
            lastSeenAt: new Date(),
            createdAt: new Date(Date.now() - 25 * 3_600_000),
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        assert.equal((await request("auth/me")).status, 401);
        const renewed = await request(
          "auth/login",
          { email: emailA, password: "integration-password-123" },
          "",
        );
        assert.equal(renewed.status, 201);
        cookieA = renewed.cookie!;
        const renewedToken = cookieA.split("=")[1];
        assert.ok(renewedToken);
        const before = await db.session.findFirstOrThrow({
          where: {
            userId: userIds[0],
            tokenHash: hashToken(renewedToken),
          },
        });
        await db.session.update({
          where: { id: before.id },
          data: { lastSeenAt: new Date(Date.now() - 60_000) },
        });
        assert.equal((await request("auth/me")).status, 200);
        const after = await db.session.findUniqueOrThrow({
          where: { id: before.id },
        });
        assert.equal(after.expiresAt.getTime(), before.expiresAt.getTime());
        assert.ok(after.lastSeenAt.getTime() > Date.now() - 10_000);
      },
    );
    await suite.test(
      "rejects cross-site fetch metadata even with an otherwise trusted Origin",
      async () => {
        const response = await fetch(`${url}/api/auth/me`, {
          headers: {
            Cookie: cookieA,
            Origin: "http://localhost:3000",
            "Sec-Fetch-Site": "cross-site",
          },
        });
        assert.equal(response.status, 403);
      },
    );
    await suite.test(
      "creates accounts and enforces account ownership",
      async () => {
        incomeCategory = (
          await request("categories", { name: "Salary", type: "INCOME" })
        ).body.id as string;
        expenseCategory = (
          await request("categories", { name: "Spending", type: "EXPENSE" })
        ).body.id as string;
        const a = await request("accounts", {
          name: "Bank",
          type: "BANK",
          currency: "EUR",
          initialBalance: "100",
        });
        assert.equal(a.status, 201);
        accountA = a.body.id as string;
        const b = await request("accounts", {
          name: "Cash",
          type: "CASH",
          currency: "EUR",
          initialBalance: "20",
        });
        accountB = b.body.id as string;
        assert.equal(
          (await request(`accounts/${accountA}/history`, undefined, cookieB))
            .status,
          404,
        );
        assert.equal(
          (
            await request(
              `accounts/${accountA}`,
              { name: "Stolen" },
              cookieB,
              "PATCH",
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("EXPENSE", "1", accountA, null),
              cookieB,
            )
          ).status,
          404,
        );
      },
    );
    await suite.test(
      "income increases balances, expenses decrease, and unauthorized transaction access fails",
      async () => {
        const income = await request(
          "transactions",
          tx("INCOME", "100", null, accountA),
        );
        assert.equal(income.status, 201);
        incomeId = income.body.id as string;
        assert.equal(
          (await request("transactions", tx("EXPENSE", "20", accountA, null)))
            .status,
          201,
        );
        assert.equal(
          (await request(`transactions/${incomeId}`, undefined, cookieB))
            .status,
          404,
        );
        assert.equal(
          (await request(`transactions/${incomeId}/void`, {}, cookieB)).status,
          404,
        );
        const accounts = (await request("accounts")).body as unknown as {
          id: string;
          currentBalance: string;
        }[];
        assert.equal(
          accounts.find((a) => a.id === accountA)?.currentBalance,
          "180",
        );
      },
    );
    await suite.test(
      "income and expenses require an owned matching category without changing balances on rejection",
      async () => {
        const before = (await request("accounts")).body;
        const count = await db.transaction.count({
          where: { userId: userIds[0] },
        });
        const foreignCategory = await request(
          "categories",
          { name: "Foreign spending", type: "EXPENSE" },
          cookieB,
        );
        assert.equal(foreignCategory.status, 201);
        for (const type of ["INCOME", "EXPENSE"]) {
          const input = tx(
            type,
            "5",
            type === "EXPENSE" ? accountA : null,
            type === "INCOME" ? accountA : null,
          );
          for (const categoryId of [undefined, null, "", "   "]) {
            assert.equal(
              (await request("transactions", { ...input, categoryId })).status,
              400,
            );
            assert.equal(
              (
                await request("transactions", {
                  ...input,
                  categoryId,
                  replacesId: incomeId,
                })
              ).status,
              400,
            );
          }
          assert.equal(
            (
              await request("transactions", {
                ...input,
                categoryId:
                  type === "INCOME" ? expenseCategory : incomeCategory,
              })
            ).status,
            404,
          );
        }
        assert.equal(
          (
            await request(
              "transactions",
              tx("EXPENSE", "5", accountA, null, {
                categoryId: foreignCategory.body.id,
              }),
            )
          ).status,
          404,
        );
        assert.equal(
          await db.transaction.count({ where: { userId: userIds[0] } }),
          count,
        );
        assert.deepEqual((await request("accounts")).body, before);
        assert.equal(
          (await db.transaction.findUniqueOrThrow({ where: { id: incomeId } }))
            .voidedAt,
          null,
        );
      },
    );
    await suite.test(
      "transfer is atomic, one logical record, and retry-safe",
      async () => {
        const invalid = await request(
          "transactions",
          tx("TRANSFER", "50", accountA, "missing"),
        );
        assert.equal(invalid.status, 404);
        assert.equal(
          await db.transaction.count({ where: { userId: userIds[0] } }),
          2,
        );
        const input = tx("TRANSFER", "50", accountA, accountB);
        const results = await Promise.all([
          request("transactions", input),
          request("transactions", input),
        ]);
        assert.equal(results[0]!.status, 201);
        assert.equal(results[0]!.body.id, results[1]!.body.id);
        assert.equal(
          await db.transaction.count({ where: { userId: userIds[0] } }),
          3,
        );
        const accounts = (await request("accounts")).body as unknown as {
          id: string;
          currentBalance: string;
        }[];
        assert.equal(
          accounts.find((a) => a.id === accountA)?.currentBalance,
          "130",
        );
        assert.equal(
          accounts.find((a) => a.id === accountB)?.currentBalance,
          "70",
        );
      },
    );
    await suite.test(
      "monthly history shows balances after each transaction and excludes other months",
      async () => {
        const history = await request(
          `accounts/${accountA}/history?month=2026-09`,
        );
        assert.equal(history.body.opening, "100");
        assert.equal(history.body.closing, "130");
        assert.equal((history.body.entries as unknown[]).length, 3);
        assert.equal(
          (await request(`accounts/${accountA}/history?month=2026-08`)).body
            .closing,
          "100",
        );
      },
    );
    await suite.test(
      "backdated insertion recalculates later balances and corrections preserve originals",
      async () => {
        await request(
          "transactions",
          tx("EXPENSE", "10", accountA, null, {
            occurredAt: "2026-09-01T12:00:00.000Z",
          }),
        );
        const history = await request(
          `accounts/${accountA}/history?month=2026-09`,
        );
        assert.equal(history.body.closing, "120");
        assert.equal(
          (history.body.entries as { balanceAfter: string }[]).at(-1)
            ?.balanceAfter,
          "90",
        );
        const corrected = await request(
          "transactions",
          tx("INCOME", "120", null, accountA, { replacesId: incomeId }),
        );
        assert.equal(corrected.status, 201);
        assert.ok(
          (await db.transaction.findUniqueOrThrow({ where: { id: incomeId } }))
            .voidedAt,
        );
        assert.equal(
          (await request(`accounts/${accountA}/history?month=2026-09`)).body
            .closing,
          "140",
        );
      },
    );
    await suite.test(
      "transfers do not inflate income and expense analytics",
      async () => {
        const report = await request("analytics?month=2026-09&currency=EUR");
        assert.equal(report.body.income, "120");
        assert.equal(report.body.expenses, "30");
        assert.equal(report.body.net, "90");
        assert.equal(
          (report.body.days as { date: string; income: string }[]).find(
            (d) => d.date === "2026-09-15",
          )?.income,
          "120",
        );
      },
    );
    await suite.test(
      "supports deep categories, prevents cycles and blocks foreign parents",
      async () => {
        let parentId: string | null = null;
        for (let i = 0; i < 15; i++) {
          const c = await request("categories", {
            name: `Level ${i}`,
            type: "EXPENSE",
            parentId,
          });
          assert.equal(c.status, 201);
          parentId = c.body.id as string;
          if (i === 0) categoryA = parentId;
          if (i === 14) categoryB = parentId;
        }
        assert.equal(
          (
            await request(
              `categories/${categoryA}`,
              { name: "Cycle", parentId: categoryB },
              cookieA,
              "PATCH",
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "categories",
              { name: "Foreign", type: "EXPENSE", parentId: categoryA },
              cookieB,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `categories/${categoryB}`,
              { name: "Foreign", parentId: null },
              cookieB,
              "PATCH",
            )
          ).status,
          404,
        );
      },
    );
    await suite.test(
      "category filtering includes every descendant and drilldown aggregates correctly",
      async () => {
        await request(
          "transactions",
          tx("EXPENSE", "5", accountA, null, { categoryId: categoryB }),
        );
        const filtered = await request(
          `transactions?month=2026-09&categoryId=${categoryA}`,
        );
        assert.equal((filtered.body as unknown as unknown[]).length, 1);
        const report = await request(
          `analytics?month=2026-09&parentId=${categoryA}`,
        );
        assert.equal(
          (report.body.distribution as { amount: string }[])[0]?.amount,
          "5",
        );
      },
    );
    await suite.test(
      "creates scoped instruments and rejects currency mismatch",
      async () => {
        investmentAccount = (
          await request("accounts", {
            name: "Broker",
            type: "INVESTMENT",
            currency: "EUR",
            initialBalance: "1000",
          })
        ).body.id as string;
        const reference = await app.get(InstrumentsService).remember({
          name: "Test fund",
          symbol: `T${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
          assetType: "ETF",
          exchange: "XETRA",
          currency: "EUR",
          mic: "XETR",
          timeZone: "Europe/Berlin",
          isin: null,
        });
        instrumentIds.push(reference.id);
        const asset = await request("assets", { instrumentId: reference.id });
        assert.equal(asset.status, 201);
        assetId = asset.body.id as string;
        const usd = (
          await request("accounts", {
            name: "USD",
            type: "BANK",
            currency: "USD",
            initialBalance: "0",
          })
        ).body.id as string;
        assert.equal(
          (await request("transactions", tx("TRANSFER", "10", accountA, usd)))
            .status,
          400,
        );
      },
    );
    await suite.test(
      "calculates BUY/SELL, fees, quantity, average cost and P/L",
      async () => {
        const base = {
          accountId: investmentAccount,
          assetId,
          currency: "EUR",
          executedAt: date,
        };
        assert.equal(
          (
            await request("investments", {
              ...base,
              type: "BUY",
              sourceAccountId: accountA,
              quantity: "10",
              pricePerUnit: "10",
              totalAmount: "100",
              fee: "2",
              clientRequestId: randomUUID(),
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await request("investments", {
              ...base,
              type: "SELL",
              quantity: "4",
              pricePerUnit: "15",
              totalAmount: "60",
              fee: "1",
              clientRequestId: randomUUID(),
            })
          ).status,
          201,
        );
        const p = await request(`accounts/${investmentAccount}/portfolio`);
        const holding = (p.body.positions as RecordData[])[0]!;
        assert.equal(holding.quantity, "6");
        assert.equal(holding.averageCost, "10.2");
        assert.equal(holding.realizedGain, "18.2");
        assert.equal(p.body.cashBalance, "1059");
        assert.equal(p.body.totalFees, "3");
        assert.equal(p.body.holdingsValue, null);
        assert.equal(
          (
            await request(
              `accounts/${investmentAccount}/portfolio`,
              undefined,
              cookieB,
            )
          ).status,
          404,
        );
      },
    );
    await suite.test("rejects oversells and rolls back the trade", async () => {
      const before = await db.investmentTransaction.count({
        where: { userId: userIds[0] },
      });
      const result = await request("investments", {
        accountId: investmentAccount,
        assetId,
        type: "SELL",
        quantity: "7",
        pricePerUnit: "15",
        totalAmount: "105",
        currency: "EUR",
        executedAt: date,
        clientRequestId: randomUUID(),
      });
      assert.equal(result.status, 400);
      assert.equal(
        await db.investmentTransaction.count({
          where: { userId: userIds[0] },
        }),
        before,
      );
    });
    await suite.test(
      "rejects negative quantities, impossible dates and userId injection",
      async () => {
        assert.equal(
          (await request("transactions", tx("EXPENSE", "-1", accountA, null)))
            .status,
          400,
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("EXPENSE", "1", accountA, null, { userId: userIds[1] }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("EXPENSE", "1", accountA, null, {
                occurredAt: "2026-02-30T00:00:00Z",
              }),
            )
          ).status,
          400,
        );
      },
    );
    await suite.test(
      "balance adjustments preserve history, exclude cashflow, and are retry-safe",
      async () => {
        const account = await request("accounts", {
          name: "Reconciliation",
          type: "BANK",
          currency: "EUR",
          initialBalance: "100",
        });
        const id = account.body.id as string;
        const path = `accounts/${id}/balance`;
        const historyBefore = await request(
          `accounts/${id}/history?month=2026-09`,
        );
        const input = {
          balance: "125.12345678",
          expectedBalance: "100",
          clientRequestId: randomUUID(),
          description: "Statement check",
        };
        const [a, b] = await Promise.all([
          request(path, input),
          request(path, input),
        ]);
        assert.equal(a.status, 201);
        assert.equal(b.status, 201);
        assert.equal(a.body.id, b.body.id);
        assert.equal(a.body.amount, "25.12345678");
        assert.equal(a.body.type, "ADJUSTMENT");
        assert.equal(a.body.destinationAccountId, id);
        assert.equal(a.body.sourceAccountId, null);
        assert.equal(
          (
            await db.account.findUniqueOrThrow({ where: { id } })
          ).initialBalance.toFixed(),
          "100",
        );
        assert.equal(
          await db.transaction.count({
            where: { userId: userIds[0], destinationAccountId: id },
          }),
          1,
        );
        const history = await request(`accounts/${id}/history`);
        assert.equal(
          (history.body.account as RecordData).currentBalance,
          "125.12345678",
        );
        assert.equal(
          (history.body.entries as RecordData[])[0]?.balanceAfter,
          "125.12345678",
        );
        assert.equal(
          (await request(`accounts/${id}/history?month=2026-09`)).body.closing,
          historyBefore.body.closing,
        );
        const report = await request(`analytics?accountId=${id}`);
        assert.equal(report.body.income, "0");
        assert.equal(report.body.expenses, "0");
        assert.equal(report.body.net, "0");
        const filtered = await request(
          `transactions?accountId=${id}&type=ADJUSTMENT`,
        );
        assert.equal((filtered.body as unknown as unknown[]).length, 1);
        assert.equal(
          (await request(path, { ...input, balance: "200" })).status,
          409,
        );
        const decrease = await request(path, {
          balance: "-10.5",
          expectedBalance: "125.12345678",
          clientRequestId: randomUUID(),
        });
        assert.equal(decrease.status, 201);
        assert.equal(decrease.body.amount, "135.62345678");
        assert.equal(decrease.body.sourceAccountId, id);
        const zero = await request(path, {
          balance: "0",
          expectedBalance: "-10.5",
          clientRequestId: randomUUID(),
        });
        assert.equal(zero.status, 201);
        assert.equal(
          (await request(`accounts/${id}/history`)).body.closing,
          "0",
        );
        const noop = {
          balance: "0",
          expectedBalance: "0",
          clientRequestId: randomUUID(),
        };
        const noChange = await request(path, noop);
        assert.equal(noChange.body.amount, "0");
        assert.equal((await request(path, noop)).body.id, noChange.body.id);
      },
    );
    await suite.test(
      "balance adjustment endpoint checks ownership, validation, archived state and concurrent writes",
      async () => {
        const account = await request("accounts", {
          name: "Concurrent cash",
          type: "CASH",
          currency: "EUR",
          initialBalance: "10",
        });
        const id = account.body.id as string;
        const path = `accounts/${id}/balance`;
        const input = {
          balance: "20",
          expectedBalance: "10",
          clientRequestId: randomUUID(),
        };
        assert.equal((await request(path, input, "")).status, 401);
        assert.equal((await request(path, input, cookieB)).status, 404);
        for (const invalid of [
          { ...input, balance: "NaN" },
          { ...input, userId: userIds[1] },
          { ...input, occurredAt: date },
          { ...input, expectedBalance: undefined },
        ])
          assert.equal((await request(path, invalid)).status, 400);
        const results = await Promise.all([
          request(path, input),
          request(path, {
            ...input,
            balance: "30",
            clientRequestId: randomUUID(),
          }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
        assert.equal(
          results.find((r) => r.status === 409)?.body.code,
          "BALANCE_CHANGED",
        );
        assert.equal(
          await db.transaction.count({ where: { destinationAccountId: id } }),
          1,
        );
        await request(
          `accounts/${id}`,
          { name: "Concurrent cash", archived: true },
          cookieA,
          "PATCH",
        );
        assert.equal(
          (await request(path, { ...input, clientRequestId: randomUUID() }))
            .status,
          404,
        );
      },
    );
    await suite.test(
      "adjustments remain fixed ledger entries when backdated activity is inserted or an adjustment is voided",
      async () => {
        const account = await request("accounts", {
          name: "Historical cash",
          type: "CASH",
          currency: "EUR",
          initialBalance: "100",
        });
        const id = account.body.id as string;
        const adjustment = await request(`accounts/${id}/balance`, {
          balance: "200",
          expectedBalance: "100",
          clientRequestId: randomUUID(),
        });
        assert.equal(adjustment.status, 201);
        await request("transactions", tx("EXPENSE", "5", id, null));
        const history = await request(`accounts/${id}/history`);
        assert.equal(
          (history.body.account as RecordData).currentBalance,
          "195",
        );
        assert.equal(
          (history.body.entries as RecordData[]).find(
            (e) => e.id === adjustment.body.id,
          )?.balanceAfter,
          "195",
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("INCOME", "100", null, id, { replacesId: adjustment.body.id }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `transactions/${adjustment.body.id}/void`,
              {},
              cookieB,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request(`transactions/${adjustment.body.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (await request(`accounts/${id}/history`)).body.closing,
          "95",
        );
        assert.ok(
          (
            await db.transaction.findUniqueOrThrow({
              where: { id: adjustment.body.id as string },
            })
          ).voidedAt,
        );
      },
    );
    await suite.test(
      "investment account reconciliation changes cash but not holdings or cost basis",
      async () => {
        const before = await request(`accounts/${investmentAccount}/portfolio`);
        const result = await request(`accounts/${investmentAccount}/balance`, {
          balance: "1234.56",
          expectedBalance: before.body.cashBalance,
          clientRequestId: randomUUID(),
        });
        assert.equal(result.status, 201);
        const after = await request(`accounts/${investmentAccount}/portfolio`);
        assert.equal(after.body.cashBalance, "1234.56");
        assert.deepEqual(after.body.positions, before.body.positions);
        assert.equal(after.body.totalFees, before.body.totalFees);
      },
    );
    await suite.test(
      "consolidated initial migration preserves constraints without legacy data cleanup",
      async () => {
        const migration = await readFile(
          new URL(
            "../../../prisma/migrations/0_init/migration.sql",
            import.meta.url,
          ),
          "utf8",
        );
        for (const name of [
          "LatestPrice_price_positive",
          "Transaction_hidden_balance_only",
          "Transaction_opening_balance_only",
          "InvestmentTransaction_no_self_correction",
          "InvestmentTransaction_fundingTransactionId_userId_fkey",
          "InvestmentTransaction_replacesId_userId_fkey",
        ])
          assert.ok(migration.includes(name));
        assert.doesNotMatch(
          migration,
          /\b(?:INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+"|DROP\s+(?:TABLE|TYPE))\b/i,
        );
        assert.doesNotMatch(
          migration,
          /CREATE (?:TABLE "DailyPrice"|TYPE "InvestmentProvider")/,
        );
      },
    );
    await suite.test(
      "funded purchases are atomic, idempotent, scoped and excluded from cashflow",
      async () => {
        const { sourceId, accountId, buy } = await fundingSetup();
        const [first, retry] = await Promise.all([
          request("investments", buy),
          request("investments", buy),
        ]);
        assert.equal(first.status, 201);
        assert.equal(retry.status, 201);
        assert.equal(first.body.id, retry.body.id);
        const fundingId = first.body.fundingTransactionId as string;
        assert.ok(fundingId);
        assert.equal(
          await db.transaction.count({
            where: { userId: userIds[0], clientRequestId: buy.clientRequestId },
          }),
          1,
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { userId: userIds[0], clientRequestId: buy.clientRequestId },
          }),
          1,
        );
        const accounts = (await request("accounts"))
          .body as unknown as RecordData[];
        assert.equal(
          accounts.find((a) => a.id === sourceId)?.currentBalance,
          "897.75",
        );
        assert.equal(
          accounts.find((a) => a.id === accountId)?.currentBalance,
          "20",
        );
        const sourceHistory = await request(
          `accounts/${sourceId}/history?month=2026-09`,
        );
        const sourceRow = (sourceHistory.body.entries as RecordData[])[0]!;
        assert.equal(sourceRow.delta, "-102.25");
        assert.equal(sourceRow.balanceAfter, "897.75");
        assert.equal(
          (sourceRow.transaction as RecordData).investmentActivityId,
          first.body.id,
        );
        const history = await request(
          `accounts/${accountId}/history?month=2026-09`,
        );
        assert.equal((history.body.entries as RecordData[]).length, 1);
        assert.equal((history.body.entries as RecordData[])[0]?.delta, "0");
        assert.equal(
          ((history.body.entries as RecordData[])[0]?.funding as RecordData)
            .amount,
          "102.25",
        );
        assert.equal(history.body.closing, "20");
        const report = await request(
          `analytics?accountId=${sourceId}&month=2026-09`,
        );
        assert.equal(report.body.income, "0");
        assert.equal(report.body.expenses, "0");
        const p = await request(`accounts/${accountId}/portfolio`);
        assert.equal(p.body.cashBalance, "20");
        assert.equal((p.body.positions as RecordData[])[0]?.quantity, "10");
        assert.equal(
          (p.body.positions as RecordData[])[0]?.averageCost,
          "10.225",
        );
        assert.equal(
          (
            await request(
              `accounts/${accountId}/portfolio?at=2026-09-20T00:00:00Z`,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              `accounts/${accountId}/portfolio?at=2026-09-01T00:00:00Z`,
            )
          ).status,
          400,
        );
        assert.equal(
          (await request("investments", { ...buy, fee: "3" })).status,
          409,
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("TRANSFER", "102.25", sourceId, accountId, {
                replacesId: fundingId,
              }),
            )
          ).status,
          400,
        );
        assert.equal(
          (await request(`transactions/${fundingId}/void`, {}, cookieB)).status,
          404,
        );
        assert.equal(
          (await request(`investments/${first.body.id}/void`, {}, cookieB))
            .status,
          404,
        );
        assert.equal(
          (await request(`investments/${first.body.id}/void`, {})).status,
          201,
        );
        const funding = await db.transaction.findUniqueOrThrow({
          where: { id: fundingId },
        });
        const entry = await db.investmentTransaction.findUniqueOrThrow({
          where: { id: first.body.id as string },
        });
        assert.ok(funding.voidedAt);
        assert.equal(funding.voidedAt.getTime(), entry.voidedAt?.getTime());
        assert.equal(funding.amount.toFixed(), "102.25");
        assert.equal(
          (await request(`accounts/${sourceId}/history?month=2026-09`)).body
            .closing,
          "1000",
        );
        assert.equal(
          (await request("investments", buy)).body.id,
          first.body.id,
        );
        assert.equal(
          await db.transaction.count({
            where: { userId: userIds[0], clientRequestId: buy.clientRequestId },
          }),
          1,
        );
      },
    );
    await suite.test(
      "funded deposits credit cash once and void together from the source history",
      async () => {
        const { sourceId, accountId } = await fundingSetup("CASH");
        const result = await request("investments", {
          accountId,
          sourceAccountId: sourceId,
          type: "DEPOSIT",
          totalAmount: "50.1",
          currency: "EUR",
          executedAt: date,
          clientRequestId: randomUUID(),
        });
        assert.equal(result.status, 201);
        const history = await request(
          `accounts/${accountId}/history?month=2026-09`,
        );
        assert.equal(history.body.closing, "70.1");
        assert.equal((history.body.entries as RecordData[]).length, 1);
        assert.equal((history.body.entries as RecordData[])[0]?.delta, "50.1");
        const p = await request(`accounts/${accountId}/portfolio`);
        assert.equal(p.body.cashBalance, "70.1");
        assert.deepEqual(p.body.positions, []);
        assert.equal(
          (
            await request(
              `transactions/${result.body.fundingTransactionId}/void`,
              {},
            )
          ).status,
          201,
        );
        assert.ok(
          (
            await db.investmentTransaction.findUniqueOrThrow({
              where: { id: result.body.id as string },
            })
          ).voidedAt,
        );
        assert.equal(
          (await request(`accounts/${accountId}/history?month=2026-09`)).body
            .closing,
          "20",
        );
        assert.equal(
          (await request(`accounts/${sourceId}/history?month=2026-09`)).body
            .closing,
          "1000",
        );
      },
    );
    await suite.test(
      "funding rejects unowned, archived, mismatched and invalid associations without records",
      async () => {
        const { sourceId, accountId, buy } = await fundingSetup();
        const usd = await request("accounts", {
          name: "USD source",
          type: "BANK",
          currency: "USD",
          initialBalance: "1000",
        });
        const foreign = await request(
          "accounts",
          {
            name: "Other user's source",
            type: "BANK",
            currency: "EUR",
            initialBalance: "1000",
          },
          cookieB,
        );
        await db.account.update({
          where: { id: sourceId },
          data: { archivedAt: new Date() },
        });
        const standardBefore = await db.transaction.count({
          where: { userId: userIds[0] },
        });
        const investmentBefore = await db.investmentTransaction.count({
          where: { userId: userIds[0] },
        });
        for (const [input, status] of [
          [{ ...buy, sourceAccountId: foreign.body.id }, 404],
          [{ ...buy, sourceAccountId: sourceId }, 404],
          [{ ...buy, sourceAccountId: usd.body.id }, 400],
          [{ ...buy, sourceAccountId: investmentAccount }, 400],
          [{ ...buy, sourceAccountId: accountId }, 400],
          [{ ...buy, sourceAccountId: null }, 400],
          [{ ...buy, sourceAccountId: undefined }, 400],
          [{ ...buy, type: "SELL" }, 400],
          [{ ...buy, userId: userIds[1] }, 400],
          [
            {
              accountId,
              type: "DEPOSIT",
              totalAmount: "50",
              currency: "EUR",
              executedAt: date,
              clientRequestId: randomUUID(),
            },
            400,
          ],
        ] as const)
          assert.equal((await request("investments", input)).status, status);
        assert.equal(
          await db.transaction.count({ where: { userId: userIds[0] } }),
          standardBefore,
        );
        assert.equal(
          await db.investmentTransaction.count({
            where: { userId: userIds[0] },
          }),
          investmentBefore,
        );
      },
    );
    await suite.test(
      "failed linked voids roll back both records and funding cannot be corrected alone",
      async () => {
        const { sourceId, accountId, buy } = await fundingSetup();
        const purchase = await request("investments", buy);
        assert.equal(purchase.status, 201);
        const sale = await request("investments", {
          ...buy,
          sourceAccountId: null,
          type: "SELL",
          pricePerUnit: "20",
          totalAmount: "200",
          fee: "0",
          executedAt: "2026-09-20T12:00:00.000Z",
          clientRequestId: randomUUID(),
        });
        assert.equal(sale.status, 201);
        for (const path of [
          `transactions/${purchase.body.fundingTransactionId}/void`,
          `investments/${purchase.body.id}/void`,
        ]) {
          assert.equal((await request(path, {})).status, 400);
          assert.equal(
            (
              await db.transaction.findUniqueOrThrow({
                where: { id: purchase.body.fundingTransactionId as string },
              })
            ).voidedAt,
            null,
          );
          assert.equal(
            (
              await db.investmentTransaction.findUniqueOrThrow({
                where: { id: purchase.body.id as string },
              })
            ).voidedAt,
            null,
          );
        }
        assert.equal(
          (await request(`accounts/${sourceId}/history?month=2026-09`)).body
            .closing,
          "897.75",
        );
        assert.equal(
          (await request(`investments/${sale.body.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (
            await request(
              `transactions/${purchase.body.fundingTransactionId}/void`,
              {},
            )
          ).status,
          201,
        );
        assert.equal(
          (await request(`accounts/${accountId}/portfolio`)).body.cashBalance,
          "20",
        );
      },
    );
    await suite.test(
      "funding collisions and foreign assets cannot leave partial financial writes",
      async () => {
        const { sourceId, accountId, buy } = await fundingSetup();
        const foreignReference = await app.get(InstrumentsService).remember({
          symbol: `FR${randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}/EUR`,
          name: "Foreign asset",
          assetType: "CRYPTO",
          currency: "EUR",
          exchange: "Binance",
          mic: "",
          timeZone: "UTC",
          isin: null,
        });
        instrumentIds.push(foreignReference.id);
        const foreignAsset = await request(
          "assets",
          { instrumentId: foreignReference.id },
          cookieB,
        );
        assert.equal(foreignAsset.status, 201);
        assert.equal(
          (
            await request("investments", {
              ...buy,
              assetId: foreignAsset.body.id,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              "transactions",
              tx("INCOME", "1", null, sourceId, {
                clientRequestId: buy.clientRequestId,
              }),
            )
          ).status,
          201,
        );
        assert.equal((await request("investments", buy)).status, 409);
        assert.equal(
          await db.investmentTransaction.count({ where: { accountId } }),
          0,
        );
        assert.equal(
          await db.transaction.count({
            where: { destinationAccountId: accountId },
          }),
          0,
        );
        assert.equal(
          (await request(`accounts/${sourceId}/history?month=2026-09`)).body
            .closing,
          "1001",
        );
      },
    );
    await suite.test(
      "persists locale and invalidates sessions at logout and expiry",
      async () => {
        assert.equal(
          (
            await request(
              "auth/settings",
              { locale: "en", timeZone: "UTC" },
              cookieA,
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal((await request("auth/me")).body.locale, "en");
        assert.equal((await request("auth/logout", {})).status, 201);
        assert.equal((await request("auth/me")).status, 401);
        const login = await request(
          "auth/login",
          { email: emailA, password: "integration-password-123" },
          "",
        );
        cookieA = login.cookie!;
        await db.session.updateMany({
          where: { userId: userIds[0] },
          data: { expiresAt: new Date(0) },
        });
        assert.equal((await request("auth/me")).status, 401);
      },
    );
    await suite.test(
      "rejects malformed JSON without stack traces and limits repeated login failures",
      async () => {
        const malformed = await fetch(`${url}/api/auth/login`, {
          method: "POST",
          headers: {
            Origin: "http://localhost:3000",
            "X-Opulya-Request": "1",
            "Content-Type": "application/json",
          },
          body: "{",
        });
        assert.equal(malformed.status, 400);
        assert.deepEqual(await malformed.json(), { code: "VALIDATION_ERROR" });
        let lastStatus = 0;
        for (let i = 0; i < 21; i++)
          lastStatus = (await request("auth/login", {}, "")).status;
        assert.equal(lastStatus, 429);
      },
    );
  } finally {
    // Delete only this run's test tenants from the dedicated test database.
    await db.investmentTransaction.deleteMany({
      where: { userId: { in: userIds } },
    });
    await db.transaction.updateMany({
      where: { userId: { in: userIds } },
      data: { replacesId: null },
    });
    await db.transaction.deleteMany({ where: { userId: { in: userIds } } });
    await db.category.updateMany({
      where: { userId: { in: userIds } },
      data: { parentId: null },
    });
    await db.category.deleteMany({ where: { userId: { in: userIds } } });
    await db.asset.deleteMany({ where: { userId: { in: userIds } } });
    await db.account.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    await app.close();
  }
});
