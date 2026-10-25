# Security

Implementation is informed by OWASP guidance, not certified or formally compliant.

## Authentication

- Emails are normalized; strict request schemas reject roles, user IDs and unknown fields.
- Signup creates a pending user without a password/session. Email verification sets the password and activates the account atomically; signup/resend use generic acknowledgements.
- New signup requires explicit acceptance of the shared `termsVersion`. The server timestamps acceptance when creating the pending user; repeat signup never changes existing acceptance. This is a signup declaration, not independently verified identity or GDPR consent. Existing users are not backfilled or forced through reacceptance. Preserve released terms in version control and bump `termsVersion` when changing them.
- Passwords use Argon2id with 64 MiB memory, three iterations and one lane. Verification enforces 15-128 characters without composition rules. Login uses generic errors and dummy hash verification for unknown users.
- Sessions use random 256-bit tokens in HttpOnly, host-only, SameSite=Strict cookies. Only SHA-256 token hashes are stored. Production cookies are Secure with the `__Host-` prefix.
- Server-enforced expiration defaults to eight hours absolute and fifteen minutes idle. Logout revokes the database session and clears its cookie. Automated market polling does not renew idle expiry.

Session hashes prevent replay from a read-only table leak; they do not protect against full database write access, server compromise or theft of an actual cookie. See the [OWASP session guide](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Authorization and financial integrity

Ownership is checked server-side for accounts, categories, transactions, assets and investment associations. The authenticated user, never a frontend user ID, defines scope. Composite foreign keys prevent cross-user financial associations.

Strict Zod validation checks money, dates, currencies and associations. Category writes prevent cycles; investment replay prevents overselling. Prisma parameterization, precise decimals, serializable transactions and idempotency keys protect ledger writes.

Corrections/voids retain original financial records. Derived balance snapshots are updated atomically; clients cannot supply them. Hidden balance changes remain internal adjustments, constrained by the database. Linked investment funding and activity cannot be mutated independently.

## API and data protection

Mutations require an exact trusted Origin, JSON and a custom request header. Cross-site Fetch Metadata requests are rejected; CORS allows only the configured origin. SameSite cookies supplement these CSRF checks. The web app uses a same-origin API proxy.

Auth endpoints have IP/account-based limits; request bodies are limited to 32 KiB. HTTP abuse counters are process-local, so multiple replicas need shared production controls. Enable `TRUST_PROXY=true` only behind one trusted proxy that overwrites forwarding headers.

Verification email attempts additionally use atomic PostgreSQL budgets shared by signup/resend: a recipient cooldown, hourly/daily recipient limits, and configurable global caps. Quota denial preserves the current verification token and returns the same generic acknowledgement. Recipient counter keys contain normalized email hashes, not plaintext addresses; expired counters are removed during send reservations. See [email verification](email-verification.md).

Helmet and frontend headers supply CSP, frame denial, referrer and content-type protection. CSP currently allows inline framework scripts/styles; nonce-based CSP remains further hardening.

Public responses exclude password hashes, secrets and stack traces. Errors use stable localized codes; sensitive requests and credential-bearing provider URLs are not logged. Keep `.env` and protected secret files out of Git and deployment bundles.

Market requests use the server-only Yahoo client, metadata is validated, cached payloads are bounded, and errors are sanitized. Shared quotas and synchronization leases persist in PostgreSQL. Catalogue responses contain public instrument metadata, not private holdings. See [market data](market-data.md), including its public-redistribution restriction.

## Deployment responsibilities

Settings privacy actions are scoped to the authenticated user. Export, erasure and processing restrictions require the current password and have a separate request limit. Downloads omit password and token hashes. Erasure serializes with ledger writes and removes correction chains, financial records, recipient counters and sessions atomically; it does not delete shared public instruments. Restricted users retain access to privacy controls, authentication and preferences but cannot use financial endpoints. See [privacy operations](privacy.md) for provider-held records and backup handling.

Use HTTPS, private PostgreSQL networking, verified database TLS, least-privilege application/migration roles, patching, backups and restore tests. Set production environment values explicitly; do not reuse development credentials. See [database setup](database-credentials.md).

Use `npm ci` with the committed lockfile. Run `npm audit --audit-level=moderate` when reviewing dependencies; assess advisories and test targeted changes rather than blindly upgrading.

Password recovery, MFA/passkeys, compromised-password screening, a durable email queue, shared HTTP abuse counters and an external penetration test remain unfinished. Email verification and secure cookies are not substitutes for these operational controls.

References: [OWASP Top 10](https://owasp.org/www-project-top-ten/), [ASVS](https://owasp.org/www-project-application-security-verification-standard/) and [API authorization guidance](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/).
