import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import {
  pendingRegistrationDays,
  privacyCleanupIntervalMs,
} from "@opulya/shared";
import { Database } from "./db.js";
import { sessionPolicy } from "./security.js";

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(Database) private readonly db: Database) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test") return;
    void this.schedule();
    this.timer = setInterval(
      () => void this.schedule(),
      privacyCleanupIntervalMs,
    );
    this.timer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.running;
  }

  private async schedule() {
    if (this.running) return;
    this.running = this.cleanup()
      .then(() => undefined)
      .catch(() => {
        // No addresses, IDs, tokens or database errors in maintenance logs.
        console.warn(
          "Privacy retention cleanup failed; will retry on the next cycle",
        );
      });
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  async cleanup(now = new Date()) {
    const { absoluteMs, idleMs } = sessionPolicy();
    return this.db.$transaction(
      async (tx) => {
        const sessions = await tx.session.deleteMany({
          where: {
            OR: [
              { expiresAt: { lte: now } },
              { createdAt: { lte: new Date(now.getTime() - absoluteMs) } },
              { lastSeenAt: { lte: new Date(now.getTime() - idleMs) } },
            ],
          },
        });
        const tokens = await tx.user.updateMany({
          where: { emailVerificationExpiresAt: { lte: now } },
          data: {
            emailVerificationTokenHash: null,
            emailVerificationExpiresAt: null,
          },
        });
        const quotas = await tx.emailQuota.deleteMany({
          where: { expiresAt: { lte: now } },
        });
        // Never purge verified accounts or any legacy unverified user with financial records.
        const registrations = await tx.user.deleteMany({
          where: {
            emailVerifiedAt: null,
            passwordHash: null,
            processingRestrictedAt: null,
            createdAt: {
              lte: new Date(
                now.getTime() - pendingRegistrationDays * 86_400_000,
              ),
            },
            accounts: { none: {} },
            categories: { none: {} },
            transactions: { none: {} },
            investments: { none: {} },
            budgets: { none: {} },
            assets: { none: {} },
          },
        });
        return {
          sessions: sessions.count,
          tokens: tokens.count,
          quotas: quotas.count,
          registrations: registrations.count,
        };
      },
      { timeout: 30_000 },
    );
  }
}
