# Opulya

[![Unit tests and coverage](https://github.com/dbazin00/opulya/actions/workflows/coverage.yml/badge.svg?branch=main)](https://github.com/dbazin00/opulya/actions/workflows/coverage.yml)
[![Unit line coverage](https://dbazin00.github.io/opulya/coverage.svg)](https://github.com/dbazin00/opulya/actions/workflows/coverage.yml)

Personal finance and investment tracking with English and Croatian interfaces. Built with Next.js, NestJS, PostgreSQL and Prisma in an npm workspace.

Monthly budgets support repeating category limits, income targets and individual month overrides.

## Local setup

Requires Node.js 22.12+, npm 10.9+ and Docker Desktop. On a fresh checkout:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:credentials
npm run db:up
npm run db:generate
npm run db:migrate
npm run dev
```

Do not overwrite an existing `.env`. Configure `RESEND_API_KEY` and `EMAIL_FROM` for signup. Yahoo Finance needs no API key; see the market-data deployment restrictions below. Restart the API after changing environment values.

Open [localhost:3000](http://localhost:3000). The API uses port 4000; local PostgreSQL uses port 5434. No users, categories or personal financial data are seeded.

## Testing

```powershell
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run test:integration
npm run test:e2e
```

Integration and browser tests require the separate `opulya_test` database; see [test database setup](docs/database-credentials.md#test-database). Browser tests use installed Edge on Windows. Elsewhere, install Chromium with `npm exec -- playwright install chromium`.

Unit coverage includes untested API, web and shared source, excluding generated code and tests. Open `coverage/unit/index.html` locally, or view percentages in the GitHub Actions summary and download its `unit-coverage` artifact (retained for 14 days). The badges show workflow status and unit line coverage from the latest successful `main` run. Integration/browser coverage is not yet collected; no percentage threshold is enforced.

For the percentage badge, set **Settings > Pages > Build and deployment > Source** to **GitHub Actions** once, before pushing these changes. Only the generated SVG is published to Pages; detailed reports stay in Actions artifacts. No extra account, repository secrets or automatic commits are needed. The badge appears after the first successful deployment and may briefly show a cached result.

## Deployment

Configure `NODE_ENV=production`, an exact HTTPS `WEB_ORIGIN`, private `DATABASE_URL`, and `API_INTERNAL_URL` before building.

```powershell
npm run build
npm run db:migrate
npm run start --workspace @opulya/api
npm run start --workspace @opulya/web
```

Run the API and web app as separate services. Compose supplies local PostgreSQL only. Before deploying, review the security, database and market-data guides below. For a populated database, follow the migration guide rather than applying the initial SQL directly.

Configure identical `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL`, `LEGAL_RETENTION_DETAILS`, `LEGAL_TRANSFER_DETAILS` and `LEGAL_NOTICE_REVIEWED` values on both services. Production registration and verification stay paused until the disclosures are complete and explicitly reviewed; existing verified users can still sign in. Settings includes data export, profile correction, processing restriction and permanent account deletion. See [privacy operations](docs/privacy.md) for retention, provider-held data and the remaining launch requirements. These controls do not certify GDPR compliance.

## Documentation

- [Database credentials and test setup](docs/database-credentials.md)
- [Email verification](docs/email-verification.md)
- [Market data and deployment restrictions](docs/market-data.md)
- [Financial calculations](docs/financial-decisions.md)
- [Security controls and deployment requirements](docs/security.md)
- [Privacy operations and launch requirements](docs/privacy.md)
- [Migrations](docs/migrations.md)
