# Password recovery

The sign-in page links to `/forgot-password`. Verified account owners receive a
localized reset email through the existing Resend transport. Unknown addresses
and unverified accounts receive the same generic acknowledgement, without a new
account or session being created. Signup verification remains a separate flow.

Reset links expire after 30 minutes, are single-use, and use 256-bit random
tokens. Only SHA-256 token hashes are stored on the user. The browser reads the
token from the URL fragment and removes it from the address bar before submission;
the reset page is marked no-index and no-referrer. Reset links use the configured
`WEB_ORIGIN`, never a client-supplied host or return URL.

The API enforces the same 15-128 character password policy as activation. A
successful reset atomically changes the password, consumes the link and revokes
all of that user's sessions. It does not automatically sign in, activate an
unverified account, or lift a privacy processing restriction. Session creation
locks and rechecks the password hash so an in-flight old-password login cannot
recreate a session after a reset.

Requests have IP and normalized-email rate limits, a one-minute recipient
cooldown and the existing persistent email budgets. Recovery shares the global
and recipient budgets with verification mail. Password-change notifications are
best-effort and budgeted too; delivery failures do not undo a completed reset.
No passwords or raw tokens are logged. Failed reset-link delivery invalidates
that delivery's token, without changing the current password or existing sessions.
Expired reset hashes and old cooldown timestamps are cleared by retention cleanup.

## Deployment

Apply the additive migration using `npm run db:migrate` before running the updated
API. It adds three nullable fields and a unique index to `User`; existing account
data is preserved. Regenerate Prisma and rebuild as usual. Production is not
changed automatically by the coding task.

No new environment variables or email provider are needed. Existing
`WEB_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_SENDS_PER_HOUR` and
`EMAIL_SENDS_PER_DAY` settings apply. Recovery remains available to existing users
even when production registration is disabled by the legal notice gate.

## Tests

- `npm test`: password schema, translations, mail rendering and session invariants.
- `npm run test:integration`: recovery privacy, expiry, reuse, quotas, delivery
  failure, token-purpose separation, concurrent consumption and session revocation.
- `npm exec -- playwright test tests/e2e/password-reset.spec.ts`: real recovery,
  English/Croatian UI, locale changes, confirmation, reuse, accessibility and mobile.

Integration and browser tests use only the guarded `opulya_test` database and
captured test mail. Real provider delivery still depends on the configured Resend
sender, domain and account limits.

## Verification on 2026-11-01

The production build, workspace type checks and lint pass. The unit suite has
340 passing tests and the API integration suite has 173 passing tests. Recovery
browser journeys pass on desktop and mobile, including Croatian and automated
accessibility checks. Existing desktop signup-password validation also passes.
The existing Croatian mobile signup-password test still fails its no-vertical-
scroll assertion, matching the failure artifact from 2026-10-31; that unrelated
layout and test were not changed.

The additive migration was applied to the verified local `opulya` and
`opulya_test` databases at `localhost:5434`, with no data reset or deletion.
Production migration and deployment remain outstanding.
