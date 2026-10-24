import { describe, expect, it } from "vitest";
import {
  budgetDeleteSchema,
  budgetKeySchema,
  budgetWriteSchema,
  monthlyInvestmentBudgets,
} from "./index.js";

const assets = [{ id: "iwda" }, { id: "btc" }];
const rules = [
  {
    assetId: "iwda",
    month: "2026-03",
    scope: "RECURRING" as const,
    amount: "1000",
  },
];
const buy = (totalAmount: string, fee = "0", assetId = "iwda") => ({
  assetId,
  type: "BUY",
  totalAmount,
  fee,
});

describe("per-asset investment goals", () => {
  it("counts gross purchases and buying fees across accounts, not market gains", () => {
    const result = monthlyInvestmentBudgets(
      assets,
      rules,
      [buy("800", "50"), buy("100", "5")],
      "2026-03",
    );
    expect(result).toMatchObject({
      planned: "1000",
      actual: "955",
      remaining: "45",
      totalActual: "955",
      count: 1,
    });
    expect(result.rows[0]).toMatchObject({
      assetId: "iwda",
      amount: "1000",
      actual: "955",
      remaining: "45",
    });
  });
  it("excludes sales, dividends, standalone fees, deposits, withdrawals, transfers and voids", () => {
    const activity = [
      buy("100", "2"),
      ...["SELL", "DIVIDEND", "FEE", "DEPOSIT", "WITHDRAWAL", "TRANSFER"].map(
        (type) => ({ ...buy("900", "10"), type }),
      ),
      { ...buy("500", "50"), voidedAt: "2026-03-15T12:00:00Z" },
    ];
    expect(
      monthlyInvestmentBudgets(assets, rules, activity, "2026-03"),
    ).toMatchObject({ actual: "102", totalActual: "102" });
  });
  it("keeps exact decimal totals and separates unselected asset purchases", () => {
    const result = monthlyInvestmentBudgets(
      assets,
      rules,
      [buy("0.1", "0.02"), buy("0.2", "0.01"), buy("40", "1", "btc")],
      "2026-03",
    );
    expect(result).toMatchObject({
      actual: "0.33",
      totalActual: "41.33",
      remaining: "999.67",
    });
    expect(result.rows[1]).toMatchObject({
      amount: null,
      actual: "41",
      remaining: null,
    });
  });
  it("supports recurring versions, overrides, zero goals and pauses per asset", () => {
    const custom = [
      ...rules,
      {
        ...rules[0]!,
        month: "2026-04",
        scope: "MONTH" as const,
        amount: "200",
      },
      { ...rules[0]!, month: "2026-05", scope: "MONTH" as const, amount: null },
      { ...rules[0]!, month: "2026-07", amount: "0" },
    ];
    const report = (month: string) =>
      monthlyInvestmentBudgets(assets, custom, [], month);
    expect(report("2026-02").planned).toBe("0");
    expect(report("2026-03").planned).toBe("1000");
    expect(report("2026-04").planned).toBe("200");
    expect(report("2026-05").count).toBe(0);
    expect(report("2026-06").planned).toBe("1000");
    expect(report("2026-07")).toMatchObject({ planned: "0", count: 1 });
  });
  it("shows exceeded goals without clamping the financial amount", () => {
    expect(
      monthlyInvestmentBudgets(assets, rules, [buy("1100", "5")], "2026-03"),
    ).toMatchObject({ actual: "1105", remaining: "-105" });
  });
  it("validates exactly one owned target shape and rejects injected fields", () => {
    const body = {
      assetId: "iwda",
      month: "2026-03",
      currency: "EUR",
      scope: "RECURRING",
      amount: "200",
    };
    expect(budgetWriteSchema.safeParse(body).success).toBe(true);
    for (const extra of [
      { categoryId: "food" },
      { userId: "other" },
      { amount: "-1" },
      { amount: "NaN" },
      { month: "2026-13" },
    ]) {
      expect(budgetWriteSchema.safeParse({ ...body, ...extra }).success).toBe(
        false,
      );
    }
    expect(
      budgetWriteSchema.safeParse({ ...body, assetId: undefined }).success,
    ).toBe(false);
    expect(
      budgetKeySchema.safeParse({
        assetId: "iwda",
        month: "2026-03",
        currency: "EUR",
      }).success,
    ).toBe(true);
    expect(
      budgetDeleteSchema.safeParse({ assetId: "iwda", currency: "EUR" })
        .success,
    ).toBe(true);
    expect(
      budgetDeleteSchema.safeParse({
        assetId: "iwda",
        categoryId: "food",
        currency: "EUR",
      }).success,
    ).toBe(false);
  });
});
