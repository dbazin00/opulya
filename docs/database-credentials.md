# Database credentials

## Development

After copying `.env.example` to `.env` and running `npm ci`, run `npm run db:credentials`. It creates a random 48-byte password in `.secrets/postgres-password` and configures `DATABASE_URL`, `TEST_DATABASE_URL` and `POSTGRES_PASSWORD_FILE`, preserving other settings. It refuses to silently overwrite existing credentials.

The helper restricts file permissions; `.env` and `.secrets/` are Git-ignored. These files are still plaintext, not an encrypted vault. Never commit, share or bundle them for deployment.

Compose mounts the password read-only at `/run/secrets/postgres_password`; its environment contains the file path, not the password. PostgreSQL defaults to the `opulya` role/database and loopback port 5434. Docker must have access to the protected source file.

## Local rotation

```powershell
npm run db:credentials -- --rotate-local
docker compose up -d --force-recreate --wait postgres
```

The helper changes the initialized role password and both connection URLs without deleting data. It accepts only the known development target at localhost:5434. Restart the API and update pgAdmin's saved password from the private secret file.

Changing the file alone does not rotate an existing database password. Do not remove the data volume. If rotation stops with `.env.next` or `.secrets/postgres-password.next` remaining, recover the matching credentials before retrying; database and filesystem changes are not atomic.

## Test database

`TEST_DATABASE_URL` must contain explicit credentials and target exactly `opulya_test`. Create it once, then apply migrations:

```powershell
docker compose exec -T postgres psql -U opulya -c 'CREATE DATABASE opulya_test;'
$env:DATABASE_URL = node --input-type=module -e "import 'dotenv/config'; process.stdout.write(process.env.TEST_DATABASE_URL)"
npm run db:migrate
Remove-Item Env:DATABASE_URL
```

Run this in a fresh shell without an existing `DATABASE_URL` override. Integration tests clean up their own tenants. Browser tests use ports 4001/3001 and may leave testing records in this database. Migration tests additionally create/drop their own disposable local database and require database-creation permission. Never point tests at the main or production database.

## Production

Use different credentials and a protected secret file or hosting secret mount. Set `POSTGRES_PASSWORD_FILE` to its host path and configure the API's `DATABASE_URL` privately. Do not run the development credential helper against production.

Keep PostgreSQL private, use TLS across hosts, and configure backups with restore testing. The Compose bootstrap role is administrative; production needs separate least-privilege application and migration roles. File-based Compose secrets are not automatically encrypted.

Compose starts PostgreSQL only. Containerized applications connect through the service hostname/port, not localhost:5434. Separate development and production project names, ports and volumes.

See [Docker Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/) and [PostgreSQL password authentication](https://www.postgresql.org/docs/17/auth-password.html).
