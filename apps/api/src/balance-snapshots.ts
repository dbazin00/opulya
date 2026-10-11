import { accountLedger } from "@opulya/shared";
import type { Prisma } from "./generated/prisma/client.js";

// Derived caches only. The original ledger remains the source of truth.
export async function refreshBalanceSnapshots(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const accounts = await tx.account.findMany({ where: { userId } });
  const transactions = await tx.transaction.findMany({
    where: { userId, voidedAt: null },
  });
  const investments = await tx.investmentTransaction.findMany({
    where: { userId, voidedAt: null },
  });
  const standard = transactions.map((entry) => ({
    ...entry,
    amount: entry.amount.toFixed(),
    occurredAt: entry.occurredAt.toISOString(),
    ledgerOrderAt: entry.ledgerOrderAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    voidedAt: null,
  }));
  const activity = investments.map((entry) => ({
    ...entry,
    totalAmount: entry.totalAmount.toFixed(),
    fee: entry.fee.toFixed(),
    balanceAfter: entry.balanceAfter?.toFixed() ?? null,
    quantity: entry.quantity?.toFixed() ?? null,
    pricePerUnit: entry.pricePerUnit?.toFixed() ?? null,
    executedAt: entry.executedAt.toISOString(),
    ledgerOrderAt: entry.ledgerOrderAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    voidedAt: null,
  }));
  const balances = new Map<
    string,
    { sourceBalanceAfter?: string; destinationBalanceAfter?: string }
  >();
  const investmentBalances = new Map<string, string>();
  const transactionsById = new Map(transactions.map((row) => [row.id, row]));
  const investmentsById = new Map(investments.map((row) => [row.id, row]));
  for (const account of accounts) {
    for (const entry of accountLedger(
      account.id,
      account.initialBalance.toFixed(),
      standard,
      activity,
    )) {
      if (entry.kind === "STANDARD") {
        const original = transactionsById.get(entry.id)!;
        const prior = balances.get(entry.id) ?? {};
        balances.set(entry.id, {
          ...prior,
          ...(original.sourceAccountId === account.id
            ? { sourceBalanceAfter: entry.balanceAfter }
            : { destinationBalanceAfter: entry.balanceAfter }),
        });
      } else {
        investmentBalances.set(entry.id, entry.balanceAfter);
        const original = investmentsById.get(entry.id)!;
        if (original.fundingTransactionId)
          balances.set(original.fundingTransactionId, {
            ...balances.get(original.fundingTransactionId),
            destinationBalanceAfter: entry.balanceAfter,
          });
      }
    }
  }
  for (const row of transactions) {
    const next = balances.get(row.id);
    const source = next?.sourceBalanceAfter ?? null;
    const destination = next?.destinationBalanceAfter ?? null;
    if (
      (row.sourceBalanceAfter?.toFixed() ?? null) !== source ||
      (row.destinationBalanceAfter?.toFixed() ?? null) !== destination
    )
      await tx.transaction.update({
        where: { id: row.id, userId },
        data: {
          sourceBalanceAfter: source,
          destinationBalanceAfter: destination,
        },
      });
  }
  for (const row of investments) {
    const next = investmentBalances.get(row.id) ?? null;
    if ((row.balanceAfter?.toFixed() ?? null) !== next)
      await tx.investmentTransaction.update({
        where: { id: row.id, userId },
        data: { balanceAfter: next },
      });
  }
}
