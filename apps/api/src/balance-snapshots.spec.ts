import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { decimal } from "@opulya/shared";
import type { Prisma } from "./generated/prisma/client.js";
import { refreshBalanceSnapshots } from "./balance-snapshots.js";

const date = (day: number) =>
  new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);
const transaction = (
  id: string,
  type: string,
  amount: string,
  source: string | null,
  destination: string | null,
  day: number,
) => ({
  id,
  userId: "u",
  type,
  amount: decimal(amount),
  sourceAccountId: source,
  destinationAccountId: destination,
  occurredAt: date(day),
  createdAt: date(day),
  voidedAt: null,
  sourceBalanceAfter: null as ReturnType<typeof decimal> | null,
  destinationBalanceAfter: null as ReturnType<typeof decimal> | null,
});

describe("ledger-derived stored balance snapshots", () => {
  function fixture(
    rows: ReturnType<typeof transaction>[],
    investments: unknown[] = [],
  ) {
    const update = vi.fn().mockResolvedValue({});
    const investmentUpdate = vi.fn().mockResolvedValue({});
    const tx = {
      account: {
        findMany: vi.fn().mockResolvedValue([
          { id: "a", initialBalance: decimal("100") },
          { id: "b", initialBalance: decimal("20") },
        ]),
      },
      transaction: { findMany: vi.fn().mockResolvedValue(rows), update },
      investmentTransaction: {
        findMany: vi.fn().mockResolvedValue(investments),
        update: investmentUpdate,
      },
    };
    return {
      tx: tx as unknown as Prisma.TransactionClient,
      update,
      investmentUpdate,
    };
  }
  it("stores income, expense and both transfer balances without floating-point errors", async () => {
    const { tx, update } = fixture([
      transaction("in", "INCOME", "0.1", null, "a", 1),
      transaction("out", "EXPENSE", "0.2", "a", null, 2),
      transaction("transfer", "TRANSFER", "30", "a", "b", 3),
    ]);
    await refreshBalanceSnapshots(tx, "u");
    expect(update).toHaveBeenCalledWith({
      where: { id: "in", userId: "u" },
      data: { sourceBalanceAfter: null, destinationBalanceAfter: "100.1" },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "out", userId: "u" },
      data: { sourceBalanceAfter: "99.9", destinationBalanceAfter: null },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "transfer", userId: "u" },
      data: { sourceBalanceAfter: "69.9", destinationBalanceAfter: "50" },
    });
  });
  it("rebuilds subsequent snapshots after inserting an older transaction", async () => {
    const { tx, update } = fixture([
      transaction("later", "EXPENSE", "20", "a", null, 3),
      transaction("older", "INCOME", "50", null, "a", 1),
    ]);
    await refreshBalanceSnapshots(tx, "u");
    expect(update).toHaveBeenCalledWith({
      where: { id: "later", userId: "u" },
      data: { sourceBalanceAfter: "130", destinationBalanceAfter: null },
    });
  });
  it("uses the investment's combined balance for linked funding without double-counting cash", async () => {
    const { tx, update, investmentUpdate } = fixture(
      [transaction("funding", "TRANSFER", "11", "a", "b", 1)],
      [
        {
          id: "buy",
          userId: "u",
          accountId: "b",
          assetId: "asset",
          type: "BUY",
          quantity: decimal("1"),
          pricePerUnit: decimal("10"),
          totalAmount: decimal("10"),
          fee: decimal("1"),
          executedAt: date(1),
          createdAt: date(1),
          fundingTransactionId: "funding",
          balanceAfter: null,
        },
      ],
    );
    await refreshBalanceSnapshots(tx, "u");
    expect(update).toHaveBeenCalledWith({
      where: { id: "funding", userId: "u" },
      data: { sourceBalanceAfter: "89", destinationBalanceAfter: "20" },
    });
    expect(investmentUpdate).toHaveBeenCalledWith({
      where: { id: "buy", userId: "u" },
      data: { balanceAfter: "20" },
    });
  });
  it("does not rewrite a snapshot that already matches the ledger", async () => {
    const row = {
      ...transaction("in", "INCOME", "50", null, "a", 1),
      destinationBalanceAfter: decimal("150"),
    };
    const { tx, update } = fixture([row]);
    await refreshBalanceSnapshots(tx, "u");
    expect(update).not.toHaveBeenCalled();
  });
});
