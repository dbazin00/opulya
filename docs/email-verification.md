# Email verification

## Configuration

Create a Resend sending-only API key and configure the private root `.env`:

```dotenv
EMAIL_TRANSPORT=resend
RESEND_API_KEY=your_private_key
EMAIL_FROM="Opulya <onboarding@resend.dev>"
EMAIL_VERIFICATION_MINUTES=60
WEB_ORIGIN=http://localhost:3000
```

Keep one `WEB_ORIGIN` entry and restart the API after changes. Run `npm run mail:check` to check configuration presence without sending mail or exposing credentials. It does not verify delivery permissions.

The test sender `onboarding@resend.dev` sends only to the email associated with your Resend account. For other recipients, verify a domain you own and use an address on that domain. See [Resend's test-sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and [domain verification](https://resend.com/docs/dashboard/domains/introduction).

In production, use the frontend's exact HTTPS origin and disable click tracking for verification links. Never expose keys through `NEXT_PUBLIC_*` variables.

## User flow

1. Signup collects names and email, creating a pending user without a password or session.
2. The mailbox owner opens the verification link and chooses/confirms a password. Opening the link alone does not activate the account.
3. The server enforces the 15-128 character password policy, activates the account and consumes the token atomically.
4. The user signs in normally. Verification does not create a session.

Resend returns a generic acknowledgement for unknown, pending and verified addresses. A one-minute cooldown and shared signup/resend limits restrict repeated sends. Duplicate signup cannot overwrite a verified account.

## Token handling

Tokens contain 32 random bytes; only SHA-256 hashes and expiry are stored. Tokens are single-use and replaced on resend. The link carries the token in a URL fragment, which the browser clears after reading it; the verification page uses no-referrer/no-index metadata.

Names are escaped in English/Croatian email templates. Emails never include passwords or financial records. Protected APIs require verified email server-side.

## Limitations and testing

Delivery runs in a bounded, best-effort background task, not a durable queue. A failed send invalidates its token if still current; shutdown before delivery may require a resend. Pending accounts are not automatically purged. Verification is not MFA or a delivery guarantee.

`EMAIL_TRANSPORT=test` is restricted to `NODE_ENV=test` and `opulya_test`. Messages are captured privately in memory or the ignored browser-test mail folder. There is no public mailbox endpoint or production verification bypass.
