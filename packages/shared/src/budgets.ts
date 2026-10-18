import { decimal, sum } from "./finance.js";

export interface BudgetRule {
  categoryId: string;
  month: string;
  scope: "RECURRING" | "MONTH";
  amount: string | null;
}

export interface BudgetCategory {
  id: string;
  parentId: string | null;
}

export interface BudgetActivity {
  categoryId: string | null;
  type: string;
  amount: string;
  voidedAt?: string | null;
}

export function resolveBudget(rules: BudgetRule[], month: string) {
  const recurring = rules
    .filter((r) => r.scope === "RECURRING" && r.month <= month)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const override = rules.find((r) => r.scope === "MONTH" && r.month === month);
  return {
    amount: (override ?? recurring)?.amount ?? null,
    scope: override
      ? ("MONTH" as const)
      : recurring
        ? ("RECURRING" as const)
        : null,
    startsAt: recurring?.month ?? null,
    recurringAmount: recurring?.amount ?? null,
    hasOverride: !!override,
  };
}

// Callers supply one user's categories, rules and activity for one month/currency.
export function monthlyBudgets(
  categories: BudgetCategory[],
  rules: BudgetRule[],
  activity: BudgetActivity[],
  month: string,
  type: "INCOME" | "EXPENSE",
) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const actual = new Map<string, string>();
  for (const entry of activity) {
    if (entry.voidedAt || entry.type !== type || !entry.categoryId) continue;
    let id: string | null = entry.categoryId;
    const visited = new Set<string>();
    while (id && byId.has(id) && !visited.has(id)) {
      visited.add(id);
      actual.set(
        id,
        decimal(actual.get(id) ?? "0")
          .add(entry.amount)
          .toFixed(),
      );
      id = byId.get(id)!.parentId;
    }
  }
  const grouped = new Map<string, BudgetRule[]>();
  for (const rule of rules) {
    const entries = grouped.get(rule.categoryId) ?? [];
    entries.push(rule);
    grouped.set(rule.categoryId, entries);
  }
  const rows = categories.map((c) => {
    const budget = resolveBudget(grouped.get(c.id) ?? [], month);
    const spent = actual.get(c.id) ?? "0";
    const remaining =
      budget.amount === null
        ? null
        : decimal(budget.amount).sub(spent).toFixed();
    return { categoryId: c.id, ...budget, actual: spent, remaining };
  });
  const plannedIds = new Set(
    rows.filter((r) => r.amount !== null).map((r) => r.categoryId),
  );
  // Only the outermost configured budget in each branch contributes to totals.
  const roots = rows.filter((r) => {
    if (r.amount === null) return false;
    let parent = byId.get(r.categoryId)?.parentId;
    const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (plannedIds.has(parent)) return false;
      visited.add(parent);
      parent = byId.get(parent)?.parentId;
    }
    return true;
  });
  const planned = sum(roots.map((r) => r.amount!));
  const tracked = sum(roots.map((r) => r.actual));
  return {
    rows,
    planned,
    actual: tracked,
    remaining: decimal(planned).sub(tracked).toFixed(),
    totalActual: sum(
      activity
        .filter((e) => !e.voidedAt && e.type === type)
        .map((e) => e.amount),
    ),
    count: plannedIds.size,
  };
}
