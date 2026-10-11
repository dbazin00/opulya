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

test("account type correction and empty-account deletion", async (suite) => {
  const app = await bootstrap(0),
    db = app.get(Database),
    url = await app.getUrl();
  const users: string[] = [];
  let cookie = "",
    foreign = "";
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
        Origin: process.env.WEB_ORIGIN!,
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
  const account = async (type = "BANK", recordInitialBalance = false) => {
    const r = await request("accounts", {
      name: "Account",
      type,
      currency: "EUR",
      initialBalance: "100",
      recordInitialBalance,
    });
    assert.equal(r.status, 201);
    return r.body.id as string;
  };
  const metadata = async (id: string) => {
    const r = await request("accounts");
    assert.equal(r.status, 200);
    return r.body.find((a: { id: string }) => a.id === id);
  };
  const fee = (accountId: string) =>
    request("investments", {
      accountId,
      type: "FEE",
      totalAmount: "2",
      currency: "EUR",
      executedAt: new Date().toISOString(),
      clientRequestId: randomUUID(),
    });
  try {
    for (let i = 0; i < 2; i++) {
      const r = await request(
        "auth/signup",
        {
          firstName: "Account",
          lastName: "Test",
          email: `accounts-${randomUUID()}@example.test`,
          password: "account-test-password-123",
        },
        "POST",
        "",
      );
      assert.equal(r.status, 201);
      users.push(r.body.id);
      if (i === 0) cookie = r.cookie!;
      else foreign = r.cookie!;
    }
    await suite.test(
      "corrects all empty account types without changing currency or balance",
      async () => {
        const id = await account();
        for (const type of ["INVESTMENT", "CASH", "BANK"]) {
          assert.equal(
            (
              await request(
                `accounts/${id}`,
                { name: "Renamed", type },
                "PATCH",
              )
            ).status,
            200,
          );
          const a = await metadata(id);
          assert.equal(a.type, type);
          assert.equal(a.currentBalance, "100");
          assert.equal(a.currency, "EUR");
          assert.equal(a.canDelete, true);
          assert.equal(a.canChangeInvestmentType, true);
          assert.equal(a._count, undefined);
          assert.equal(a.outgoing, undefined);
        }
      },
    );
    await suite.test(
      "deletes empty baseline accounts, including archived ones, but not other users' accounts",
      async () => {
        const id = await account();
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE", "")).status,
          401,
        );
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE", foreign)).status,
          404,
        );
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Foreign", type: "CASH" },
              "PATCH",
              foreign,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Account", archived: true },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE")).status,
          200,
        );
        assert.equal(await db.account.count({ where: { id } }), 0);
        assert.equal((await request(`accounts/${id}/history`)).status, 404);
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE")).status,
          404,
        );
        assert.equal(
          (await request(`accounts/${id}`, { name: "Gone" }, "PATCH")).status,
          404,
        );
      },
    );
    await suite.test(
      "validates patch/delete bodies and rejects client-owned authorization or currency changes",
      async () => {
        const id = await account();
        for (const extra of [
          { type: "OTHER" },
          { type: null },
          { userId: users[1] },
          { currency: "USD" },
          { canDelete: true },
        ]) {
          assert.equal(
            (
              await request(
                `accounts/${id}`,
                { name: "Account", ...extra },
                "PATCH",
              )
            ).status,
            400,
          );
        }
        assert.equal(
          (await request(`accounts/${id}`, { userId: users[0] }, "DELETE"))
            .status,
          400,
        );
        assert.equal((await metadata(id)).type, "BANK");
      },
    );
    await suite.test(
      "a recorded opening balance counts as transaction history",
      async () => {
        const id = await account("BANK", true);
        assert.equal((await metadata(id)).canDelete, false);
        const r = await request(`accounts/${id}`, {}, "DELETE");
        assert.equal(r.status, 409);
        assert.equal(r.body.code, "ACCOUNT_HAS_TRANSACTIONS");
        assert.equal((await metadata(id)).currentBalance, "100");
      },
    );
    await suite.test(
      "hidden and voided adjustments prevent deletion but preserve ordinary type corrections",
      async () => {
        const id = await account();
        const adjustment = await request(`accounts/${id}/balance`, {
          balance: "120",
          expectedBalance: "100",
          description: null,
          clientRequestId: randomUUID(),
          recordTransaction: false,
        });
        assert.equal(adjustment.status, 201);
        assert.equal((await metadata(id)).canDelete, false);
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE")).status,
          409,
        );
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Cash", type: "CASH" },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal((await metadata(id)).currentBalance, "120");
        const tx = await db.transaction.findFirstOrThrow({
          where: { userId: users[0], destinationAccountId: id },
        });
        assert.equal(
          (await request(`transactions/${tx.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE")).status,
          409,
        );
        assert.equal((await metadata(id)).canDelete, false);
      },
    );
    await suite.test(
      "both sides of a transfer have history and cannot be deleted",
      async () => {
        const source = await account(),
          destination = await account();
        const r = await request("transactions", {
          type: "TRANSFER",
          sourceAccountId: source,
          destinationAccountId: destination,
          amount: "5",
          currency: "EUR",
          occurredAt: new Date().toISOString(),
          clientRequestId: randomUUID(),
        });
        assert.equal(r.status, 201);
        for (const id of [source, destination]) {
          assert.equal((await metadata(id)).canDelete, false);
          assert.equal(
            (await request(`accounts/${id}`, {}, "DELETE")).status,
            409,
          );
        }
      },
    );
    await suite.test(
      "investment activity blocks conversion/deletion even after voiding, but allows rename/archive",
      async () => {
        const id = await account("INVESTMENT"),
          activity = await fee(id);
        assert.equal(activity.status, 201);
        assert.equal((await metadata(id)).canChangeInvestmentType, false);
        for (const type of ["BANK", "CASH"]) {
          const r = await request(
            `accounts/${id}`,
            { name: "Wrong", type },
            "PATCH",
          );
          assert.equal(r.status, 409);
          assert.equal(r.body.code, "ACCOUNT_TYPE_HAS_INVESTMENTS");
        }
        assert.equal((await metadata(id)).name, "Account");
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Archived", type: "INVESTMENT", archived: true },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Restored", archived: false },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (await request(`investments/${activity.body.id}/void`, {})).status,
          201,
        );
        assert.equal(
          (
            await request(
              `accounts/${id}`,
              { name: "Wrong", type: "BANK" },
              "PATCH",
            )
          ).status,
          409,
        );
        assert.equal(
          (await request(`accounts/${id}`, {}, "DELETE")).status,
          409,
        );
        assert.equal((await metadata(id)).canDelete, false);
      },
    );
    await suite.test(
      "investment funding sources can switch bank/cash but not become investment accounts",
      async () => {
        const source = await account(),
          target = await account("INVESTMENT");
        const r = await request("investments", {
          accountId: target,
          sourceAccountId: source,
          type: "DEPOSIT",
          totalAmount: "10",
          currency: "EUR",
          executedAt: new Date().toISOString(),
          clientRequestId: randomUUID(),
        });
        assert.equal(r.status, 201);
        assert.equal((await metadata(source)).canChangeInvestmentType, false);
        assert.equal(
          (
            await request(
              `accounts/${source}`,
              { name: "Cash", type: "CASH" },
              "PATCH",
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await request(
              `accounts/${source}`,
              { name: "Wrong", type: "INVESTMENT" },
              "PATCH",
            )
          ).status,
          409,
        );
        assert.equal((await metadata(source)).currentBalance, "90");
        await request(`investments/${r.body.id}/void`, {});
        assert.equal(
          (
            await request(
              `accounts/${source}`,
              { name: "Wrong", type: "INVESTMENT" },
              "PATCH",
            )
          ).status,
          409,
        );
      },
    );
    await suite.test(
      "serializes deletion against a simultaneous financial write",
      async () => {
        const id = await account();
        const [removed, adjusted] = await Promise.all([
          request(`accounts/${id}`, {}, "DELETE"),
          request(`accounts/${id}/balance`, {
            balance: "110",
            expectedBalance: "100",
            description: null,
            clientRequestId: randomUUID(),
            recordTransaction: false,
          }),
        ]);
        assert.ok(
          (removed.status === 200 && adjusted.status === 404) ||
            (removed.status === 409 && adjusted.status === 201),
          JSON.stringify([removed, adjusted]),
        );
        const count = await db.transaction.count({
          where: {
            userId: users[0],
            OR: [{ sourceAccountId: id }, { destinationAccountId: id }],
          },
        });
        assert.equal(count, removed.status === 200 ? 0 : 1);
      },
    );
    await suite.test(
      "serializes investment type changes against concurrent investment activity",
      async () => {
        const id = await account("INVESTMENT");
        const [changed, activity] = await Promise.all([
          request(`accounts/${id}`, { name: "Account", type: "BANK" }, "PATCH"),
          fee(id),
        ]);
        assert.ok(
          (changed.status === 200 && activity.status === 400) ||
            (changed.status === 409 && activity.status === 201),
          JSON.stringify([changed, activity]),
        );
        const a = await metadata(id);
        assert.equal(a.type, activity.status === 201 ? "INVESTMENT" : "BANK");
      },
    );
  } finally {
    await db.investmentTransaction.deleteMany({
      where: { userId: { in: users } },
    });
    await db.transaction.deleteMany({ where: { userId: { in: users } } });
    await db.account.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
