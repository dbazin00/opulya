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

test("category deletion, archiving and restoration", async (suite) => {
  const app = await bootstrap(0);
  const db = app.get(Database);
  const url = await app.getUrl();
  const users: string[] = [];
  let cookie = "",
    foreign = "",
    accountId = "",
    root = "",
    used = "",
    entryId = "";
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
  const category = async (name: string, parentId: string | null = null) => {
    const result = await request("categories", {
      name,
      type: "EXPENSE",
      parentId,
    });
    assert.equal(result.status, 201);
    return result.body.id as string;
  };
  const expense = (categoryId: string, amount = "15", replacesId?: string) =>
    request("transactions", {
      type: "EXPENSE",
      sourceAccountId: accountId,
      amount,
      currency: "EUR",
      categoryId,
      occurredAt: new Date().toISOString(),
      clientRequestId: randomUUID(),
      ...(replacesId ? { replacesId } : {}),
    });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await request(
        "auth/signup",
        {
          firstName: "Category",
          lastName: "Test",
          email: `categories-${randomUUID()}@example.test`,
          password: "category-test-password-123",
        },
        "POST",
        "",
      );
      assert.equal(result.status, 201);
      users.push(result.body.id);
      if (i === 0) cookie = result.cookie!;
      else foreign = result.cookie!;
    }
    const account = await request("accounts", {
      name: "Bank",
      type: "BANK",
      currency: "EUR",
      initialBalance: "100",
    });
    assert.equal(account.status, 201);
    accountId = account.body.id;
    root = await category("Food");
    used = await category("Groceries", root);

    await suite.test(
      "allows DELETE in CORS preflight only for the configured web origin",
      async () => {
        for (const origin of [
          "http://localhost:3000",
          "https://untrusted.example",
        ]) {
          const response = await fetch(`${url}/api/categories/${used}`, {
            method: "OPTIONS",
            headers: {
              Origin: origin,
              "Access-Control-Request-Method": "DELETE",
            },
          });
          assert.equal(
            response.headers.get("access-control-allow-origin"),
            "http://localhost:3000",
          );
          assert.ok(
            response.headers
              .get("access-control-allow-methods")
              ?.split(",")
              .includes("DELETE"),
          );
        }
      },
    );

    await suite.test(
      "deletes only unused leaves and validates the body",
      async () => {
        const unused = await category("Mistake");
        assert.equal(
          (
            await request(
              `categories/${unused}`,
              { userId: users[0] },
              "DELETE",
            )
          ).status,
          400,
        );
        assert.equal(
          (await request(`categories/${unused}`, {}, "DELETE")).status,
          200,
        );
        assert.equal(await db.category.count({ where: { id: unused } }), 0);
        assert.equal(
          (await request(`categories/${unused}`, {}, "DELETE")).status,
          404,
        );
      },
    );
    await suite.test(
      "rejects unauthenticated and foreign delete, archive, restore and edit",
      async () => {
        for (const [suffix, method] of [
          ["", "DELETE"],
          ["/archive", "POST"],
          ["/restore", "POST"],
        ]) {
          assert.equal(
            (await request(`categories/${used}${suffix}`, {}, method, ""))
              .status,
            401,
          );
          assert.equal(
            (await request(`categories/${used}${suffix}`, {}, method, foreign))
              .status,
            404,
          );
        }
        assert.equal(
          (
            await request(
              `categories/${used}`,
              { name: "Stolen", parentId: null },
              "PATCH",
              foreign,
            )
          ).status,
          404,
        );
        assert.equal(
          (await db.category.findUniqueOrThrow({ where: { id: used } }))
            .archivedAt,
          null,
        );
      },
    );
    await suite.test(
      "requires moving or removing children before deleting or archiving parents",
      async () => {
        for (const [suffix, method] of [
          ["", "DELETE"],
          ["/archive", "POST"],
        ]) {
          const result = await request(
            `categories/${root}${suffix}`,
            {},
            method,
          );
          assert.equal(result.status, 409);
          assert.equal(result.body.code, "CATEGORY_HAS_CHILDREN");
        }
      },
    );
    await suite.test(
      "archives used categories without changing transactions, balances or drill-down analytics",
      async () => {
        const entry = await expense(used);
        assert.equal(entry.status, 201);
        entryId = entry.body.id;
        const deletion = await request(`categories/${used}`, {}, "DELETE");
        assert.equal(deletion.status, 409);
        assert.equal(deletion.body.code, "CATEGORY_IN_USE");
        assert.equal(
          (await request(`categories/${used}/archive`, {})).status,
          201,
        );
        const archived = (await request("categories")).body.find(
          (c: { id: string }) => c.id === used,
        );
        assert.ok(archived.archivedAt);
        assert.equal(archived._count.transactions, 1);
        const transactions = await request("transactions");
        assert.equal(transactions.body[0].categoryId, used);
        assert.equal((await request("accounts")).body[0].currentBalance, "85");
        const analytics = await request(
          `analytics?currency=EUR&parentId=${root}`,
        );
        assert.equal(analytics.body.expenses, "15");
        assert.equal(
          analytics.body.distribution.find((c: { id: string }) => c.id === used)
            .amount,
          "15",
        );
      },
    );
    await suite.test(
      "archived children still prevent deleting or archiving the parent",
      async () => {
        for (const [suffix, method] of [
          ["", "DELETE"],
          ["/archive", "POST"],
        ])
          assert.equal(
            (await request(`categories/${root}${suffix}`, {}, method)).body
              .code,
            "CATEGORY_HAS_CHILDREN",
          );
      },
    );
    await suite.test(
      "rejects new transactions, edits and child associations to archived categories",
      async () => {
        assert.equal((await expense(used)).body.code, "CATEGORY_ARCHIVED");
        assert.equal(
          (
            await request(
              `categories/${used}`,
              { name: "Renamed", parentId: root },
              "PATCH",
            )
          ).body.code,
          "CATEGORY_ARCHIVED",
        );
        assert.equal(
          (
            await request("categories", {
              name: "Child",
              type: "EXPENSE",
              parentId: used,
            })
          ).body.code,
          "CATEGORY_ARCHIVED",
        );
        const other = await category("Other");
        assert.equal(
          (
            await request(
              `categories/${other}`,
              { name: "Other", parentId: used },
              "PATCH",
            )
          ).body.code,
          "CATEGORY_ARCHIVED",
        );
        assert.equal(
          await db.transaction.count({ where: { userId: users[0] } }),
          1,
        );
      },
    );
    await suite.test(
      "corrections may retain the original archived category, not choose another archived category",
      async () => {
        const other = await category("Old");
        await request(`categories/${other}/archive`, {});
        assert.equal(
          (await expense(other, "20", entryId)).body.code,
          "CATEGORY_ARCHIVED",
        );
        const corrected = await expense(used, "20", entryId);
        assert.equal(corrected.status, 201);
        entryId = corrected.body.id;
        assert.equal((await request("accounts")).body[0].currentBalance, "80");
        assert.equal(
          (await request("analytics?currency=EUR")).body.expenses,
          "20",
        );
      },
    );
    await suite.test("voided history also prevents deletion", async () => {
      assert.equal(
        (await request(`transactions/${entryId}/void`, {})).status,
        201,
      );
      assert.equal(
        (await request(`categories/${used}`, {}, "DELETE")).body.code,
        "CATEGORY_IN_USE",
      );
      assert.equal((await request("accounts")).body[0].currentBalance, "100");
      assert.equal(
        await db.transaction.count({
          where: { userId: users[0], categoryId: used },
        }),
        2,
      );
    });
    await suite.test(
      "restoration re-enables the category without changing its identity or history",
      async () => {
        const restored = await request(`categories/${used}/restore`, {});
        assert.equal(restored.status, 201);
        assert.equal(restored.body.archivedAt, null);
        assert.equal(restored.body.parentId, root);
        assert.equal((await expense(used, "3")).status, 201);
        assert.equal((await request("accounts")).body[0].currentBalance, "97");
      },
    );
    await suite.test(
      "serializes deletion against a concurrently inserted transaction",
      async () => {
        const id = await category("Race");
        const [deletion, entry] = await Promise.all([
          request(`categories/${id}`, {}, "DELETE"),
          expense(id, "1"),
        ]);
        assert.ok(
          (deletion.status === 200 && entry.status === 404) ||
            (deletion.status === 409 && entry.status === 201),
          JSON.stringify([deletion, entry]),
        );
        if (entry.status === 201) {
          assert.equal(deletion.body.code, "CATEGORY_IN_USE");
          assert.ok(await db.category.findUnique({ where: { id } }));
        }
      },
    );
  } finally {
    await db.transaction.deleteMany({ where: { userId: { in: users } } });
    await db.category.updateMany({
      where: { userId: { in: users } },
      data: { parentId: null },
    });
    await db.category.deleteMany({ where: { userId: { in: users } } });
    await db.account.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await app.close();
  }
});
