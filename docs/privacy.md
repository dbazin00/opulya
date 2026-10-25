# Privacy operations

Technical controls are not a GDPR certification. The operator must complete the unverified items below before public registration. An individual can be the controller; a product name alone is not a controller identity.

## Launch requirements

- Publish the actual operator name and a monitored privacy/security email.
- Confirm the purposes and legal bases below, including a legitimate-interests assessment for security processing. Do not use acceptance of terms as blanket GDPR consent.
- Record Vercel, Render, Neon and Resend contracts, subprocessors, actual regions, support access, retention and any international-transfer mechanism. EU database hosting alone is insufficient. None of these deployment facts has been verified in this repository.
- Confirm database encryption/TLS, least-privilege access, provider-account MFA, patching, backup access and restore testing. Assess providers' logging and telemetry; app code alone cannot establish whether production tracking exists.
- Set the same five `LEGAL_*` values from `.env.example` on Vercel and Render. `LEGAL_RETENTION_DETAILS` must state actual log, email, backup and inactive-account retention; `LEGAL_TRANSFER_DETAILS` must identify actual locations, safeguards and how to obtain them. Set `LEGAL_NOTICE_REVIEWED=true` only after review, then redeploy both services. Production signup, resend and verification remain paused otherwise; existing verified users can still sign in.
- Apply the privacy migration before starting the updated API. It adds a restriction timestamp and an index, not new tables.

## Processing record

Maintain this record with the operator's identity/contact, authorized access, actual locations, safeguards and retention. The legal bases are proposed for operator review, not a completed legal assessment.

| Activity                            | Data and purpose                                                                                                                    | Proposed basis                                                               | Recipients / retention                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Account and financial records       | Name, email, preferences, terms acceptance, accounts, categories, budgets, assets and ledger history; provide the requested service | Contract / requested pre-contract steps                                      | Hosting/database providers; while the account exists, including inactive verified accounts, until erasure                          |
| Verification                        | Address, first name, verification message and token hash; confirm mailbox ownership                                                 | Requested pre-contract steps                                                 | Resend and hosting; unverified empty registrations removed after 7 days; provider-held email retention still requires confirmation |
| Authentication and abuse prevention | Password/token hashes, sessions, restriction status, recipient email hashes and technical request data                              | Contract and legitimate interests in account/service security, as applicable | Hosting/database/email providers; application cleanup below, provider logs still require confirmation                              |
| Public market search                | User-entered search and public instrument identifiers; catalogue/quotes                                                             | Contract                                                                     | Yahoo Finance through the server; no private balances or transaction history sent; warn users not to enter personal data           |

Minimise names and free-text information; do not add marketing or sensitive-data collection without assessment. Financial descriptions may reveal sensitive information even though financial data is not automatically an Article 9 category. Assess likelihood/severity, data scale, vulnerable users, profiling and national DPIA lists. Record whether a DPIA or DPO is required and why; neither is automatically required for every finance app. Review after material changes.

## Application retention

- Cleanup runs at API startup and hourly while it is running. Sleeping/failed services delay cleanup until a successful run; investigate the generic cleanup-failure warning. Automated tests call cleanup explicitly.
- Pending users older than 7 days are deleted only when unverified, without a password, without a restriction and without any financial records. Verified users and legacy records are not silently purged.
- Expired verification-token hashes, idle/expired sessions and expired email counters are removed. Session validity does not depend on cleanup. Recipient counters expire within one day.
- Self-service deletion removes the user's active-database records and all sessions atomically. It preserves shared public catalogue data. Archiving/voiding/correcting a record is not erasure.
- Downloads contain all user-owned application records, including archived, hidden, voided and corrected history, plus session metadata and recipient-counter metadata. No password hashes or token hashes are exported. Decimal strings preserve precision; timestamps are ISO 8601 UTC.
- Provider email, technical logs and backups are outside this download/deletion workflow. Confirm and publish their actual maximum retention, including backup expiry. Do not claim immediate universal erasure.

## Rights requests

1. Monitor the published contact address. Log receipt, scope, verification, deadline, decisions, recipients notified and completion in a restricted register outside this repository. Minimise the register's identifiers and define its retention.
2. Normally respond within one month. A permitted complexity/volume extension is up to two further months; explain it within the first month. Do not impose a fee or additional ID documents by default. Verify identity proportionately, preferably through the authenticated account or verified address.
3. Offer Settings export, correction, restriction or erasure without making those controls mandatory. Handle people without account access and requests for provider-held information manually. For email correction, verify control of both the account and the new address before a controlled update; do not bypass verification or send records to an unverified destination.
4. Handle access information, objections, restriction, consent withdrawal where applicable, and any exceptions individually. Notify relevant recipients of corrections, erasure or restriction where required. Explain a refusal, its basis, and complaint/judicial-remedy rights. Record and notify the individual before lifting an operator-imposed restriction; do not treat silence as permission.
5. Apply required provider-side deletion. Keep a minimal, access-controlled deletion record for the backup lifecycle. On restoration, keep the restored system isolated and reapply completed erasures and restrictions before making it available. Erase the deletion record when no longer needed. Test this procedure; it is not automated by the app.

## Breach response

1. Assign an incident owner and record when the incident was discovered and when a personal-data breach became known. Contain access, revoke compromised sessions/keys, preserve necessary evidence and involve affected providers. Do not place production data or secrets in GitHub issues or this repository.
2. Assess confidentiality, integrity and availability, affected data/people, likely consequences, protective measures and risk. Document every personal-data breach and the reasoning for notification or non-notification in a restricted register.
3. Notify the competent authority without undue delay and within 72 hours of awareness unless the breach is unlikely to risk individuals' rights/freedoms. Provide information in phases if needed and explain delays. Notify affected people without undue delay when the breach is likely to create a high risk, subject to applicable exceptions.
4. Track containment, notifications, remediation and follow-up. Test the response and restore process and periodically review access and provider settings.

References: [EDPB rights](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en), [security](https://www.edpb.europa.eu/sme/be-compliant/secure-personal-data_en), [transfers](https://www.edpb.europa.eu/sme/be-compliant/international-data-transfers_en), [breaches](https://www.edpb.europa.eu/sme/assess-the-risks/data-breaches_en).
