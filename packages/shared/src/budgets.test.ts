import { describe, expect, it } from "vitest";
import {
  budgetQuerySchema,
  budgetWriteSchema,
  monthlyBudgets,
  resolveBudget,
  type BudgetRule,
} from "./index.js";

const rule = (
  month: string,
  amount: string | null,
  scope: BudgetRule["scope"] = "RECURRING",
  categoryId = "food",
): BudgetRule => ({ month, amount, scope, categoryId });

describe("monthly budgeting", () => {
  it("repeats from the effective month, never backwards", () => {
    const rules = [rule("2026-03", "500"), rule("2026-06", "600")];
    expect(resolveBudget(rules, "2026-02").amount).toBeNull();
    expect(resolveBudget(rules, "2026-03").amount).toBe("500");
    expect(resolveBudget(rules, "2026-05").amount).toBe("500");
    expect(resolveBudget(rules, "2026-06").amount).toBe("600");
    expect(resolveBudget(rules, "2027-01").amount).toBe("600");
  });
  it("isolates month overrides and resumes the repeating amount", () => {
    const rules = [rule("2026-01", "100"), rule("2026-03", "250", "MONTH")];
    expect(resolveBudget(rules, "2026-03")).toMatchObject({
      amount: "250",
      recurringAmount: "100",
      hasOverride: true,
    });
    expect(resolveBudget(rules, "2026-04").amount).toBe("100");
  });
  it("keeps explicit overrides when the repeating amount changes", () => {
    expect(
      resolveBudget(
        [
          rule("2026-01", "100"),
          rule("2026-06", "200"),
          rule("2026-07", "300", "MONTH"),
        ],
        "2026-07",
      ).amount,
    ).toBe("300");
  });
  it("supports zero limits, skipped months, stopped and restarted recurrence", () => {
    const rules = [
      rule("2026-01", "100"),
      rule("2026-02", null, "MONTH"),
      rule("2026-03", "0", "MONTH"),
      rule("2026-05", null),
      rule("2026-08", "150"),
    ];
    expect(resolveBudget(rules, "2026-02")).toMatchObject({
      amount: null,
      hasOverride: true,
    });
    expect(resolveBudget(rules, "2026-03").amount).toBe("0");
    expect(resolveBudget(rules, "2026-04").amount).toBe("100");
    expect(resolveBudget(rules, "2026-06").amount).toBeNull();
    expect(resolveBudget(rules, "2026-08").amount).toBe("150");
  });
  it("aggregates arbitrary category depth without double counting parent and child plans", () => {
    const categories = Array.from({ length: 40 }, (_, i) => ({
      id: String(i),
      parentId: i ? String(i - 1) : null,
    }));
    const result = monthlyBudgets(
      categories,
      [
        rule("2026-01", "100", "RECURRING", "0"),
        rule("2026-01", "40", "RECURRING", "39"),
      ],
      [{ categoryId: "39", type: "EXPENSE", amount: "20" }],
      "2026-02",
      "EXPENSE",
    );
    expect(result.rows.every((r) => r.actual === "20")).toBe(true);
    expect(result).toMatchObject({
      planned: "100",
      actual: "20",
      remaining: "80",
      count: 2,
    });
  });
  it("counts separately budgeted siblings once and includes direct parent spending", () => {
    const categories = [
      { id: "food", parentId: null },
      { id: "groceries", parentId: "food" },
      { id: "rent", parentId: null },
    ];
    const rules = [
      rule("2026-01", "100"),
      rule("2026-01", "50", "RECURRING", "groceries"),
      rule("2026-01", "500", "RECURRING", "rent"),
    ];
    const activity = [
      { categoryId: "food", type: "EXPENSE", amount: "20" },
      { categoryId: "groceries", type: "EXPENSE", amount: "30" },
      { categoryId: "rent", type: "EXPENSE", amount: "500" },
    ];
    expect(
      monthlyBudgets(categories, rules, activity, "2026-03", "EXPENSE"),
    ).toMatchObject({
      planned: "600",
      actual: "550",
      remaining: "50",
      totalActual: "550",
    });
  });
  it("excludes transfers, adjustments, income and voided expenses", () => {
    const activity = ["TRANSFER", "ADJUSTMENT", "INCOME"].map((type) => ({
      categoryId: "food",
      type,
      amount: "999",
    }));
    activity.push({ categoryId: "food", type: "EXPENSE", amount: "0.1" });
    const result = monthlyBudgets(
      [{ id: "food", parentId: null }],
      [rule("2026-01", "0.3")],
      [
        ...activity,
        {
          categoryId: "food",
          type: "EXPENSE",
          amount: "999",
          voidedAt: "2026-02-01",
        },
        { categoryId: "food", type: "EXPENSE", amount: "0.2" },
      ],
      "2026-02",
      "EXPENSE",
    );
    expect(result).toMatchObject({
      actual: "0.3",
      remaining: "0",
      totalActual: "0.3",
    });
  });
  it("tracks overspending and unbudgeted spending separately", () => {
    const result = monthlyBudgets(
      [
        { id: "food", parentId: null },
        { id: "rent", parentId: null },
      ],
      [rule("2026-01", "10")],
      [
        { categoryId: "food", type: "EXPENSE", amount: "15" },
        { categoryId: "rent", type: "EXPENSE", amount: "100" },
      ],
      "2026-01",
      "EXPENSE",
    );
    expect(result).toMatchObject({
      actual: "15",
      remaining: "-5",
      totalActual: "115",
    });
  });
  it("supports income targets independently", () => {
    expect(
      monthlyBudgets(
        [{ id: "salary", parentId: null }],
        [rule("2026-01", "1000", "RECURRING", "salary")],
        [
          { categoryId: "salary", type: "INCOME", amount: "1100" },
          { categoryId: "salary", type: "EXPENSE", amount: "20" },
        ],
        "2026-01",
        "INCOME",
      ),
    ).toMatchObject({ actual: "1100", remaining: "-100" });
  });
  it("falls back to independently budgeted children when their parent is disabled", () => {
    expect(
      monthlyBudgets(
        [
          { id: "food", parentId: null },
          { id: "child", parentId: "food" },
        ],
        [
          rule("2026-01", "100"),
          rule("2026-03", null, "MONTH"),
          rule("2026-01", "30", "RECURRING", "child"),
        ],
        [],
        "2026-03",
        "EXPENSE",
      ).planned,
    ).toBe("30");
  });
  it("rejects malformed months, negative, nonfinite, numeric and overprecision amounts", () => {
    const body = {
      categoryId: "food",
      currency: "EUR",
      month: "2026-03",
      scope: "MONTH",
      amount: "10",
    };
    for (const amount of ["-1", "NaN", "Infinity", "1e3", "1.123456789", 10])
      expect(budgetWriteSchema.safeParse({ ...body, amount }).success).toBe(
        false,
      );
    for (const month of ["2026-13", "0000-01", "2026-1", "2026-02-01"])
      expect(budgetWriteSchema.safeParse({ ...body, month }).success).toBe(
        false,
      );
    expect(
      budgetWriteSchema.safeParse({ ...body, userId: "other" }).success,
    ).toBe(false);
    expect(budgetWriteSchema.safeParse({ ...body, amount: "0" }).success).toBe(
      true,
    );
    expect(budgetWriteSchema.safeParse({ ...body, amount: null }).success).toBe(
      true,
    );
    expect(budgetQuerySchema.parse({ month: "2026-03" })).toMatchObject({
      type: "EXPENSE",
      currency: "EUR",
    });
  });
});
