import { createHash } from "node:crypto";
import type { DbTransaction } from "./db.js";
import type { MailService } from "./mail.js";

export class EmailBudgetExceeded extends Error {}

export function verificationQuotas(
  email: string,
  settings: Pick<
    MailService["settings"],
    "EMAIL_SENDS_PER_HOUR" | "EMAIL_SENDS_PER_DAY"
  >,
  now: Date,
) {
  const recipient = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex");
  return [
    {
      scope: "global",
      window: "hour",
      duration: 3_600_000,
      limit: settings.EMAIL_SENDS_PER_HOUR,
    },
    {
      scope: "global",
      window: "day",
      duration: 86_400_000,
      limit: settings.EMAIL_SENDS_PER_DAY,
    },
    {
      scope: `recipient:${recipient}`,
      window: "hour",
      duration: 3_600_000,
      limit: 3,
    },
    {
      scope: `recipient:${recipient}`,
      window: "day",
      duration: 86_400_000,
      limit: 5,
    },
  ].map(({ scope, window, duration, limit }) => {
    const bucket = Math.floor(now.getTime() / duration);
    return {
      key: `verification:${scope}:${window}:${bucket}`,
      limit,
      expiresAt: new Date((bucket + 1) * duration),
    };
  });
}

// Reserve in the token-issuance transaction; exceeding any limit rolls back all reservations.
export async function reserveVerificationEmail(
  tx: DbTransaction,
  email: string,
  settings: Parameters<typeof verificationQuotas>[1],
  now: Date,
) {
  await tx.emailQuota.deleteMany({ where: { expiresAt: { lte: now } } });
  for (const { key, limit, expiresAt } of verificationQuotas(
    email,
    settings,
    now,
  )) {
    const quota = await tx.emailQuota.upsert({
      where: { key },
      create: { key, count: 1, expiresAt },
      update: { count: { increment: 1 } },
    });
    if (quota.count > limit) throw new EmailBudgetExceeded();
  }
}
