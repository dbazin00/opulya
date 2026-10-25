import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { testDatabaseUrl } from "../../../packages/config/test-database.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cli = fileURLToPath(
  new URL("../../../node_modules/prisma/build/index.js", import.meta.url),
);

test("migrations create the final schema on an empty database", async (suite) => {
  const source = new URL(testDatabaseUrl());
  assert.ok(["localhost", "127.0.0.1"].includes(source.hostname));
  assert.equal(source.port, "5434");
  const name = `opulya_migration_verify_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  assert.match(name, /^opulya_migration_verify_[a-f0-9]{12}$/);
  const target = new URL(source);
  target.pathname = `/${name}`;
  const admin = new pg.Client({ connectionString: source.toString() });
  const db = new pg.Client({ connectionString: target.toString() });
  let created = false;
  const prisma = (...args: string[]) =>
    execFileSync(process.execPath, [cli, ...args], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: target.toString() },
      encoding: "utf8",
      timeout: 60000,
      stdio: "pipe",
    });
  try {
    await admin.connect();
    // Only this generated, verified identifier is used in database-level DDL.
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    prisma("migrate", "deploy");
    await db.connect();
    assert.equal(
      (await db.query("SELECT current_database() AS name")).rows[0]?.name,
      name,
    );

    await suite.test(
      "applies the baseline and additive migrations and matches the Prisma schema",
      () => {
        assert.doesNotThrow(() =>
          prisma(
            "migrate",
            "diff",
            "--from-config-datasource",
            "--to-schema",
            "prisma/schema.prisma",
            "--exit-code",
          ),
        );
      },
    );
    await suite.test(
      "does not seed users, financial records or predefined categories",
      async () => {
        const history = await db.query(
          'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
        );
        assert.deepEqual(
          history.rows.map((row) => row.migration_name),
          [
            "0_init",
            "20261017120000_email_send_limits",
            "20261018120000_monthly_budgets",
            "20261020120000_instrument_exchange_name",
            "20261021120000_on_demand_quotes",
            "20261022120000_terms_acceptance",
            "20261024120000_investment_budgets",
            "20261024130000_privacy_controls",
          ],
        );
        for (const table of [
          "User",
          "Account",
          "Category",
          "Transaction",
          "Asset",
          "InvestmentTransaction",
          "EmailQuota",
          "Budget",
        ])
          assert.equal(
            (await db.query(`SELECT count(*)::int AS count FROM "${table}"`))
              .rows[0]?.count,
            0,
          );
        const obsolete = await db.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='DailyPrice'",
        );
        assert.equal(obsolete.rowCount, 0);
        const provider = await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Account' AND column_name='provider'",
        );
        assert.equal(provider.rowCount, 0);
      },
    );
    await suite.test(
      "retains precise balance snapshots and financial constraints",
      async () => {
        const columns = await db.query(
          "SELECT numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema='public' AND (table_name='Transaction' AND column_name IN ('sourceBalanceAfter','destinationBalanceAfter') OR table_name='InvestmentTransaction' AND column_name='balanceAfter')",
        );
        assert.equal(columns.rowCount, 3);
        for (const column of columns.rows)
          assert.deepEqual(column, { numeric_precision: 48, numeric_scale: 8 });
        const checks = await db.query(
          "SELECT conname FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace ORDER BY conname",
        );
        assert.deepEqual(
          checks.rows.map((row) => row.conname),
          [
            "Budget_amount_check",
            "Budget_month_check",
            "Budget_target_check",
            "InvestmentTransaction_no_self_correction",
            "Transaction_hidden_balance_only",
            "Transaction_opening_balance_only",
            "User_terms_acceptance_check",
          ],
        );
      },
    );

    await db.query(`INSERT INTO "User" (id,"firstName","lastName",email,"updatedAt") VALUES
      ('u-a','Migration','Fixture','migration-a@example.invalid',now()),
      ('u-b','Migration','Fixture','migration-b@example.invalid',now())`);
    await db.query(`INSERT INTO "Account" (id,"userId",name,type,currency,"initialBalance","updatedAt") VALUES
      ('bank-a','u-a','Fixture bank','BANK','EUR',0,now()),
      ('inv-a','u-a','Fixture investment','INVESTMENT','EUR',0,now())`);
    await db.query(`INSERT INTO "Instrument" (id,name,symbol,"assetType",exchange,currency,identity)
      VALUES ('coin','Fixture coin','BTC/EUR','CRYPTO','Yahoo Finance','EUR','fixture')`);
    const constraint =
      (name: string, code = "23514") =>
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === code &&
        "constraint" in error &&
        error.constraint === name;
    await db.query(
      `INSERT INTO "Category" (id,"userId",type,name,"updatedAt") VALUES ('category-a','u-a','EXPENSE','Budget fixture',now())`,
    );
    await db.query(
      `INSERT INTO "Asset" (id,"userId",symbol,name,"assetType",currency,"updatedAt") VALUES ('asset-a','u-a','IWDA.AS','Fixture ETF','ETF','EUR',now())`,
    );
    await suite.test(
      "enforces exactly one budget target and asset ownership",
      async () => {
        const insert = (
          user: string,
          categoryId: string | null,
          assetId: string | null,
        ) =>
          db.query(
            'INSERT INTO "Budget" (id,"userId","categoryId","assetId",currency,month,scope,amount,"updatedAt") VALUES ($1,$2,$3,$4,\'EUR\',\'2026-03\',\'RECURRING\',100,now())',
            [randomUUID(), user, categoryId, assetId],
          );
        await assert.rejects(
          insert("u-a", null, null),
          constraint("Budget_target_check"),
        );
        await assert.rejects(
          insert("u-a", "category-a", "asset-a"),
          constraint("Budget_target_check"),
        );
        await assert.rejects(
          insert("u-b", null, "asset-a"),
          constraint("Budget_assetId_userId_fkey", "23503"),
        );
        await insert("u-a", null, "asset-a");
      },
    );
    await suite.test(
      "enforces budget amounts, months and category ownership at the database boundary",
      async () => {
        const insert = (user: string, month: string, amount: string) =>
          db.query(
            'INSERT INTO "Budget" (id,"userId","categoryId",currency,month,scope,amount,"updatedAt") VALUES ($1,$2,\'category-a\',\'EUR\',$3,\'RECURRING\',$4,now())',
            [randomUUID(), user, month, amount],
          );
        await assert.rejects(
          insert("u-a", "2026-03", "-1"),
          constraint("Budget_amount_check"),
        );
        await assert.rejects(
          insert("u-a", "2026-13", "10"),
          constraint("Budget_month_check"),
        );
        await assert.rejects(
          insert("u-b", "2026-03", "10"),
          constraint("Budget_categoryId_userId_fkey", "23503"),
        );
      },
    );
    await suite.test(
      "does not persist live prices or obsolete scheduler state",
      async () => {
        assert.equal(
          (
            await db.query(
              "SELECT to_regclass('public.\"LatestPrice\"') AS name",
            )
          ).rows[0]?.name,
          null,
        );
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='InstrumentMapping' AND column_name IN ('lastAttemptAt','lastSuccessAt','error','currentRequestedAt')",
            )
          ).rows[0]?.count,
          0,
        );
      },
    );
    await suite.test("rejects hidden income and expense history", async () => {
      await assert.rejects(
        db.query(`INSERT INTO "Transaction" (id,"userId",type,"destinationAccountId",amount,currency,"occurredAt","updatedAt","clientRequestId","visibleInHistory")
        VALUES ('hidden','u-a','INCOME','bank-a',1,'EUR',now(),now(),'hidden',false)`),
        constraint("Transaction_hidden_balance_only"),
      );
    });
    await suite.test(
      "allows opening markers only on visible balance adjustments",
      async () => {
        await assert.rejects(
          db.query(`INSERT INTO "Transaction" (id,"userId",type,"sourceAccountId",amount,currency,"occurredAt","updatedAt","clientRequestId","isOpeningBalance")
        VALUES ('opening','u-a','EXPENSE','bank-a',1,'EUR',now(),now(),'opening',true)`),
          constraint("Transaction_opening_balance_only"),
        );
      },
    );
    await suite.test("rejects investment self-corrections", async () => {
      await assert.rejects(
        db.query(`INSERT INTO "InvestmentTransaction" (id,"userId","accountId",type,"totalAmount",currency,"executedAt","updatedAt","clientRequestId","replacesId")
        VALUES ('self','u-a','inv-a','DEPOSIT',1,'EUR',now(),now(),'self','self')`),
        constraint("InvestmentTransaction_no_self_correction"),
      );
    });
    await suite.test("preserves same-user account foreign keys", async () => {
      await assert.rejects(
        db.query(`INSERT INTO "Transaction" (id,"userId",type,"destinationAccountId",amount,currency,"occurredAt","updatedAt","clientRequestId")
        VALUES ('foreign','u-b','INCOME','bank-a',1,'EUR',now(),now(),'foreign')`),
        constraint("Transaction_destinationAccountId_userId_fkey", "23503"),
      );
    });
  } finally {
    await db.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
});
