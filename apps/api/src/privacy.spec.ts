import "reflect-metadata";
import { afterEach, expect, it, vi } from "vitest";
import { AuthService } from "./auth.js";
import type { Database } from "./db.js";
import type { MailService } from "./mail.js";
import { PrivacyService } from "./privacy.js";
import { RetentionService } from "./retention.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

it("blocks production registration, resend and activation before any database/mail access", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LEGAL_NOTICE_REVIEWED", "false");
  const db = {} as Database,
    mail = {} as MailService;
  const service = new AuthService(db, mail);
  await expect(service.signup({})).rejects.toThrow("REGISTRATION_UNAVAILABLE");
  await expect(service.resendVerification({})).rejects.toThrow(
    "REGISTRATION_UNAVAILABLE",
  );
  await expect(service.verifyEmail({})).rejects.toThrow(
    "REGISTRATION_UNAVAILABLE",
  );
});

it("validates privacy bodies before opening a database transaction", async () => {
  const transaction = vi.fn();
  const service = new PrivacyService({
    $transaction: transaction,
  } as unknown as Database);
  await expect(
    service.export("me", { password: "valid", userId: "other" }),
  ).rejects.toThrow();
  await expect(service.delete("me", { password: "valid" })).rejects.toThrow();
  await expect(
    service.profile("me", {
      firstName: "A",
      lastName: "B",
      email: "unverified@example.test",
    }),
  ).rejects.toThrow();
  expect(transaction).not.toHaveBeenCalled();
});

it("retention only selects empty, unverified old registrations and expired authentication data", async () => {
  vi.stubEnv("SESSION_HOURS", "8");
  vi.stubEnv("SESSION_IDLE_MINUTES", "15");
  const remove = () => vi.fn().mockResolvedValue({ count: 0 });
  const tx = {
    user: { deleteMany: remove(), updateMany: remove() },
    session: { deleteMany: remove() },
    emailQuota: { deleteMany: remove() },
  };
  const db = {
    $transaction: (action: (client: typeof tx) => Promise<unknown>) =>
      action(tx),
  } as unknown as Database;
  const now = new Date("2026-10-24T12:00:00Z");
  await new RetentionService(db).cleanup(now);
  expect(tx.user.deleteMany).toHaveBeenCalledWith({
    where: {
      emailVerifiedAt: null,
      passwordHash: null,
      processingRestrictedAt: null,
      createdAt: { lte: new Date("2026-10-17T12:00:00Z") },
      accounts: { none: {} },
      categories: { none: {} },
      transactions: { none: {} },
      investments: { none: {} },
      budgets: { none: {} },
      assets: { none: {} },
    },
  });
  expect(tx.session.deleteMany).toHaveBeenCalledWith({
    where: {
      OR: [
        { expiresAt: { lte: now } },
        { createdAt: { lte: new Date("2026-10-24T04:00:00Z") } },
        { lastSeenAt: { lte: new Date("2026-10-24T11:45:00Z") } },
      ],
    },
  });
  expect(tx.emailQuota.deleteMany).toHaveBeenCalledWith({
    where: { expiresAt: { lte: now } },
  });
});
