import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "./generated/prisma/client.js";
import { refreshBalanceSnapshots } from "./balance-snapshots.js";

export function isTransactionConflict(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  )
    return true;
  // Commit-time adapter conflicts may arrive without Prisma's P2034 wrapper.
  return (
    error instanceof Error &&
    error.name === "DriverAdapterError" &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "kind" in error.cause &&
    error.cause.kind === "TransactionWriteConflict"
  );
}

@Injectable()
export class Database extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error("DATABASE_URL is required");
    super({
      adapter: new PrismaPg({
        connectionString,
        max: 5,
        connectionTimeoutMillis: 5_000,
      }),
      log: [],
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
  async financial<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
    resolve?: (tx: Prisma.TransactionClient, value: T) => Promise<T>,
  ): Promise<T> {
    return this.atomic(userId, async (tx) => {
      const value = await action(tx);
      await refreshBalanceSnapshots(tx, userId);
      return resolve ? resolve(tx, value) : value;
    });
  }
  async atomic<T>(
    userId: string,
    action: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(
          async (tx) => {
            // Serialize writes per user so concurrent trades cannot oversell and category moves cannot race.
            await tx.user.update({
              where: { id: userId },
              data: { ledgerVersion: { increment: 1 } },
            });
            return action(tx);
          },
          { isolationLevel: "Serializable", timeout: 15_000 },
        );
      } catch (error) {
        if (isTransactionConflict(error) && attempt < 3) {
          await new Promise((resolve) =>
            setTimeout(resolve, 10 * (attempt + 1)),
          );
          continue;
        }
        throw error;
      }
    }
  }
}
export type DbTransaction = Prisma.TransactionClient;
