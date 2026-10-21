# Migrations

## Baseline

The active schema starts with `prisma/migrations/0_init/migration.sql`. `migration_lock.toml` records the PostgreSQL provider. No categories or financial records are seeded.

`20261017120000_email_send_limits` adds shared verification-email counters without changing existing records. Apply pending migrations before deploying the corresponding API; never rewrite an already deployed baseline.

`20261021120000_on_demand_quotes` removes the disposable price cache and obsolete scheduler fields. It preserves accounts, assets and investment history; no database reset is needed.

The final schema includes three checks not represented by Prisma's datamodel:

- `Transaction_hidden_balance_only`: only adjustments can be hidden.
- `Transaction_opening_balance_only`: opening entries must be visible adjustments.
- `InvestmentTransaction_no_self_correction`: an activity cannot replace itself.

Preserve these checks when generating future migrations.

## Fresh database

Configure credentials, start PostgreSQL, then run `npm run db:migrate`.

## Populated database

Back up the database before any schema change. Only a database already matching the complete baseline, including custom checks, can mark it applied:

```powershell
npm exec -- prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
npm exec -- prisma migrate resolve --applied 0_init
npm run db:migrate
```

Verify `DATABASE_URL` privately before running commands. Stop on a schema difference. Prisma's diff does not verify unsupported custom checks; inspect those separately before resolving the baseline.

The initial SQL is not an upgrade script for a partially initialized database. Existing applied entries in `_prisma_migrations` are audit history, not pending migrations; do not delete them for cosmetic cleanup.

Generate future migrations against a disposable development database. Never accept a reset against financial data without explicit approval and a backup.

## Tests

`apps/api/test/migrations.test.ts` applies all migrations to its own generated `opulya_migration_verify_*` database, checks schema, constraints and absence of seed data, then drops only that database. It requires database-creation permission on localhost:5434.

See Prisma's [baselining](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/baselining) and [squashing](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/squashing-migrations) guides.
