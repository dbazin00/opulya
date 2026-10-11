import { Decimal } from "decimal.js";
Decimal.set({ precision: 48, rounding: Decimal.ROUND_HALF_EVEN });
export { Decimal };
export const decimal = (value: string | number | Decimal) => new Decimal(value);
export const sum = (values: string[]) =>
  values.reduce((total, value) => total.add(value), new Decimal(0)).toFixed();

export interface LedgerTransaction {
  id: string;
  type: "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
  amount: string;
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  occurredAt: string;
  createdAt: string;
  ledgerOrderAt?: string | null;
  voidedAt?: string | null;
  visibleInHistory?: boolean;
}
export interface InvestmentEntry {
  id: string;
  replacesId?: string | null;
  ledgerOrderAt?: string | null;
  fundingTransactionId?: string | null;
  balanceAfter?: string | null;
  accountId: string;
  assetId: string | null;
  type: "BUY" | "SELL" | "DIVIDEND" | "FEE" | "DEPOSIT" | "WITHDRAWAL";
  quantity: string | null;
  pricePerUnit: string | null;
  totalAmount: string;
  fee: string;
  executedAt: string;
  createdAt: string;
  voidedAt?: string | null;
}
export const orderEntries = <
  T extends { id: string; createdAt: string; ledgerOrderAt?: string | null },
>(
  entries: T[],
  time: (v: T) => string,
) =>
  [...entries].sort(
    (a, b) =>
      time(a).localeCompare(time(b)) ||
      (a.ledgerOrderAt ?? a.createdAt).localeCompare(
        b.ledgerOrderAt ?? b.createdAt,
      ) ||
      a.id.localeCompare(b.id),
  );
export function transactionDelta(
  tx: LedgerTransaction,
  accountId: string,
): string {
  if (tx.voidedAt) return "0";
  if (tx.sourceAccountId === accountId)
    return decimal(tx.amount).neg().toFixed();
  if (tx.destinationAccountId === accountId) return tx.amount;
  return "0";
}
export function investmentDelta(tx: InvestmentEntry): string {
  if (tx.voidedAt) return "0";
  if (tx.type === "DEPOSIT" && tx.fundingTransactionId) return "0";
  return ["SELL", "DIVIDEND", "DEPOSIT"].includes(tx.type)
    ? decimal(tx.totalAmount).sub(tx.fee).toFixed()
    : decimal(tx.totalAmount).add(tx.fee).neg().toFixed();
}
export function accountLedger(
  accountId: string,
  initialBalance: string,
  transactions: LedgerTransaction[],
  investments: InvestmentEntry[] = [],
) {
  // A funded investment is one atomic activity in the destination history.
  // Its transfer remains a normal debit in the source account's history.
  const funding = new Map(
    transactions
      .filter((t) => !t.voidedAt && t.type === "TRANSFER")
      .map((t) => [t.id, t]),
  );
  const grouped = new Set(
    investments
      .filter(
        (t) =>
          !t.voidedAt &&
          t.accountId === accountId &&
          funding.get(t.fundingTransactionId ?? "")?.destinationAccountId ===
            accountId,
      )
      .map((t) => t.fundingTransactionId!),
  );
  const entries = [
    ...transactions
      .filter(
        (t) =>
          !t.voidedAt &&
          !grouped.has(t.id) &&
          (t.sourceAccountId === accountId ||
            t.destinationAccountId === accountId),
      )
      .map((t) => ({
        id: t.id,
        timestamp: t.occurredAt,
        createdAt: t.ledgerOrderAt ?? t.createdAt,
        delta: transactionDelta(t, accountId),
        kind: "STANDARD" as const,
        type: t.type,
      })),
    ...investments
      .filter((t) => !t.voidedAt && t.accountId === accountId)
      .map((t) => ({
        id: t.id,
        timestamp: t.executedAt,
        createdAt: t.ledgerOrderAt ?? t.createdAt,
        delta: decimal(investmentDelta(t))
          .add(
            grouped.has(t.fundingTransactionId ?? "")
              ? transactionDelta(
                  funding.get(t.fundingTransactionId!)!,
                  accountId,
                )
              : "0",
          )
          .toFixed(),
        kind: "INVESTMENT" as const,
        type: t.type,
      })),
  ];
  let balance = decimal(initialBalance);
  return orderEntries(entries, (t) => t.timestamp).map((entry) => {
    balance = balance.add(entry.delta);
    return { ...entry, balanceAfter: balance.toFixed() };
  });
}
export function cashflow(transactions: LedgerTransaction[]) {
  const active = transactions.filter((t) => !t.voidedAt);
  const income = sum(
    active.filter((t) => t.type === "INCOME").map((t) => t.amount),
  );
  const expenses = sum(
    active.filter((t) => t.type === "EXPENSE").map((t) => t.amount),
  );
  return { income, expenses, net: decimal(income).sub(expenses).toFixed() };
}

export function portfolio(
  entries: InvestmentEntry[],
  prices: Record<string, string | null> = {},
) {
  const holdings = new Map<
    string,
    {
      quantity: Decimal;
      costBasis: Decimal;
      invested: Decimal;
      realized: Decimal;
      fees: Decimal;
      dividends: Decimal;
    }
  >();
  let totalFees = decimal(0);
  let dividends = decimal(0);
  for (const tx of orderEntries(
    entries.filter((t) => !t.voidedAt),
    (t) => t.executedAt,
  )) {
    totalFees = totalFees
      .add(tx.fee)
      .add(tx.type === "FEE" ? tx.totalAmount : 0);
    if (tx.type === "DIVIDEND")
      dividends = dividends.add(tx.totalAmount).sub(tx.fee);
    if (!tx.assetId) continue;
    const h = holdings.get(tx.assetId) ?? {
      quantity: decimal(0),
      costBasis: decimal(0),
      invested: decimal(0),
      realized: decimal(0),
      fees: decimal(0),
      dividends: decimal(0),
    };
    const qty = decimal(tx.quantity ?? "0");
    h.fees = h.fees.add(tx.fee);
    if (tx.type === "BUY") {
      const cost = decimal(tx.totalAmount).add(tx.fee);
      h.quantity = h.quantity.add(qty);
      h.costBasis = h.costBasis.add(cost);
      h.invested = h.invested.add(cost);
    } else if (tx.type === "SELL") {
      if (qty.gt(h.quantity)) throw new Error("INSUFFICIENT_HOLDINGS");
      const soldCost = h.costBasis.mul(qty).div(h.quantity);
      h.realized = h.realized.add(
        decimal(tx.totalAmount).sub(tx.fee).sub(soldCost),
      );
      h.quantity = h.quantity.sub(qty);
      h.costBasis = h.quantity.isZero()
        ? decimal(0)
        : h.costBasis.sub(soldCost);
    } else if (tx.type === "DIVIDEND")
      h.dividends = h.dividends.add(tx.totalAmount).sub(tx.fee);
    holdings.set(tx.assetId, h);
  }
  const positions = [...holdings].map(([assetId, h]) => {
    const price = prices[assetId];
    const value = h.quantity.isZero()
      ? decimal(0)
      : price != null
        ? h.quantity.mul(price)
        : null;
    const gain = value?.sub(h.costBasis) ?? null;
    return {
      assetId,
      quantity: h.quantity.toFixed(),
      costBasis: h.costBasis.toFixed(),
      totalInvested: h.invested.toFixed(),
      averageCost: h.quantity.isZero()
        ? "0"
        : h.costBasis.div(h.quantity).toFixed(),
      currentPrice: price ?? null,
      marketValue: value?.toFixed() ?? null,
      unrealizedGain: gain?.toFixed() ?? null,
      returnPercent:
        gain && h.costBasis.gt(0)
          ? gain.div(h.costBasis).mul(100).toFixed()
          : null,
      realizedGain: h.realized.toFixed(),
      fees: h.fees.toFixed(),
      dividends: h.dividends.toFixed(),
    };
  });
  return {
    positions,
    totalFees: totalFees.toFixed(),
    dividends: dividends.toFixed(),
    realizedGain: sum(positions.map((p) => p.realizedGain)),
    holdingsValue: positions.every((p) => p.marketValue !== null)
      ? sum(positions.map((p) => p.marketValue!))
      : null,
  };
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  type: string;
}
export function categoryTree<T extends CategoryNode>(
  categories: T[],
  collapsed: ReadonlySet<string> = new Set(),
) {
  const children = new Map<string | null, T[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  const pending = (children.get(null) ?? [])
    .map((category) => ({ category, depth: 0 }))
    .reverse();
  const rows: { category: T; depth: number; childCount: number }[] = [];
  const visited = new Set<string>();
  while (pending.length) {
    const row = pending.pop()!;
    if (visited.has(row.category.id)) continue;
    visited.add(row.category.id);
    const nested = children.get(row.category.id) ?? [];
    rows.push({ ...row, childCount: nested.length });
    if (!collapsed.has(row.category.id)) {
      for (let i = nested.length - 1; i >= 0; i--)
        pending.push({ category: nested[i]!, depth: row.depth + 1 });
    }
  }
  return rows;
}
export function descendants(
  categories: CategoryNode[],
  root: string,
): Set<string> {
  const children = new Map<string, string[]>();
  for (const c of categories) {
    if (c.parentId)
      children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
  }
  const result = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return result;
}
export function validateParent(
  categories: CategoryNode[],
  id: string,
  parentId: string | null,
  type: string,
): void {
  if (!parentId) return;
  const parent = categories.find((c) => c.id === parentId);
  if (!parent || parent.type !== type) throw new Error("INVALID_PARENT");
  if (descendants(categories, id).has(parentId))
    throw new Error("CATEGORY_CYCLE");
}
