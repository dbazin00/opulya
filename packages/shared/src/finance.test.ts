import { describe, expect, it } from "vitest";
import {
  accountLedger,
  cashflow,
  categoryTree,
  descendants,
  portfolio,
  validateParent,
  type InvestmentEntry,
  type LedgerTransaction,
} from "./finance.js";
import {
  accountSchema,
  balanceAdjustmentSchema,
  investmentSchema,
  signupSchema,
  termsVersion,
  transactionSchema,
} from "./validation.js";
import {
  formatDate,
  formatMoney,
  preferredLocale,
  priceRefreshInterval,
  resolveLocale,
} from "./locale.js";
const standard = (
  id: string,
  type: LedgerTransaction["type"],
  amount: string,
  occurredAt = "2026-09-15T12:00:00.000Z",
): LedgerTransaction => ({
  id,
  type,
  amount,
  sourceAccountId: type === "INCOME" ? null : "a",
  destinationAccountId:
    type === "EXPENSE" ? null : type === "TRANSFER" ? "b" : "a",
  occurredAt,
  createdAt: "2026-09-20T12:00:00.000Z",
});
const trade = (
  id: string,
  type: InvestmentEntry["type"],
  quantity: string | null,
  totalAmount: string,
  fee = "0",
  executedAt = "2026-09-15T12:00:00.000Z",
): InvestmentEntry => ({
  id,
  type,
  quantity,
  totalAmount,
  fee,
  executedAt,
  accountId: "a",
  assetId: ["DEPOSIT", "WITHDRAWAL", "FEE"].includes(type) ? null : "asset",
  pricePerUnit: quantity ? "10" : null,
  createdAt: executedAt,
});
describe("precise account ledger", () => {
  it("increases income and decreases expenses without float errors", () =>
    expect(
      accountLedger("a", "0", [
        standard("1", "INCOME", "0.1"),
        standard("2", "INCOME", "0.2"),
        standard("3", "EXPENSE", "0.05"),
      ]).at(-1)?.balanceAfter,
    ).toBe("0.25"));
  it("applies one logical transfer to both accounts", () => {
    const tx = [standard("1", "TRANSFER", "30")];
    expect(accountLedger("a", "100", tx)[0]?.balanceAfter).toBe("70");
    expect(accountLedger("b", "20", tx)[0]?.balanceAfter).toBe("50");
  });
  it("excludes transfers from income and expense analytics", () =>
    expect(
      cashflow([
        standard("1", "INCOME", "100"),
        standard("2", "EXPENSE", "20"),
        standard("3", "TRANSFER", "50"),
      ]),
    ).toEqual({ income: "100", expenses: "20", net: "80" }));
  it("shows the balance after each transaction", () =>
    expect(
      accountLedger("a", "100", [
        standard("1", "INCOME", "20"),
        standard("2", "EXPENSE", "42.5"),
      ]).map((e) => e.balanceAfter),
    ).toEqual(["120", "77.5"]));
  it("recalculates every later balance after historical insertion", () => {
    const rows = [
      standard("2", "EXPENSE", "20"),
      standard("1", "INCOME", "50", "2026-09-01T00:00:00.000Z"),
    ];
    expect(accountLedger("a", "100", rows).map((e) => e.balanceAfter)).toEqual([
      "150",
      "130",
    ]);
  });
  it("retains but excludes voided entries", () =>
    expect(
      accountLedger("a", "10", [
        { ...standard("1", "EXPENSE", "5"), voidedAt: "2026-09-30T00:00:00Z" },
      ]),
    ).toEqual([]));
  it("orders equal timestamps deterministically", () =>
    expect(
      accountLedger("a", "0", [
        standard("b", "EXPENSE", "1"),
        standard("a", "INCOME", "2"),
      ]).map((e) => e.id),
    ).toEqual(["a", "b"]));
  it("includes investment cash flows exactly once", () =>
    expect(
      accountLedger(
        "a",
        "100",
        [],
        [
          trade("1", "BUY", "2", "20", "1"),
          trade("2", "DIVIDEND", null, "3", "0.5"),
        ],
      ).at(-1)?.balanceAfter,
    ).toBe("81.5"));
  it("does not change unrelated account balances", () =>
    expect(
      accountLedger("c", "100", [standard("1", "TRANSFER", "30")]),
    ).toEqual([]));
  it("keeps large decimal amounts precise", () =>
    expect(
      accountLedger("a", "999999999999999.99", [
        standard("1", "INCOME", "0.01"),
      ])[0]?.balanceAfter,
    ).toBe("1000000000000000"));
});
describe("recursive categories", () => {
  const categories = Array.from({ length: 1000 }, (_, i) => ({
    id: String(i),
    parentId: i ? String(i - 1) : null,
    type: "EXPENSE",
  }));
  it("supports arbitrary nesting without recursive call-stack limits", () =>
    expect(descendants(categories, "0").size).toBe(1000));
  it("lists all 1000 category levels in parent-first order", () => {
    const rows = categoryTree(categories);
    expect(rows).toHaveLength(1000);
    expect(rows[999]).toMatchObject({
      category: { id: "999" },
      depth: 999,
      childCount: 0,
    });
    expect(rows[0]?.childCount).toBe(1);
  });
  it("collapses only the selected branch and preserves other roots", () => {
    const rows = categoryTree(
      [...categories, { id: "salary", parentId: null, type: "INCOME" }],
      new Set(["0"]),
    );
    expect(rows.map((r) => r.category.id)).toEqual(["0", "salary"]);
    expect(
      categoryTree(categories, new Set(["1"])).map((r) => r.category.id),
    ).toEqual(["0", "1"]);
  });
  it("rejects own-parent cycles", () =>
    expect(() => validateParent(categories, "5", "5", "EXPENSE")).toThrow(
      "CATEGORY_CYCLE",
    ));
  it("rejects descendant-parent cycles at depth 1000", () =>
    expect(() => validateParent(categories, "0", "999", "EXPENSE")).toThrow(
      "CATEGORY_CYCLE",
    ));
  it("rejects foreign or mismatched parent categories", () => {
    expect(() =>
      validateParent(categories, "new", "missing", "EXPENSE"),
    ).toThrow("INVALID_PARENT");
    expect(() => validateParent(categories, "new", "5", "INCOME")).toThrow(
      "INVALID_PARENT",
    );
  });
  it("allows deep valid insertion and moving to root", () => {
    expect(() =>
      validateParent(categories, "new", "999", "EXPENSE"),
    ).not.toThrow();
    expect(() =>
      validateParent(categories, "5", null, "EXPENSE"),
    ).not.toThrow();
  });
});
describe("balance adjustments", () => {
  const adjustment: LedgerTransaction = {
    ...standard("adjust", "ADJUSTMENT", "25.55", "2026-09-21T00:00:00.000Z"),
    sourceAccountId: null,
    destinationAccountId: "a",
  };
  it("adds and subtracts adjustments without affecting cashflow", () => {
    const entries = [
      standard("income", "INCOME", "20"),
      standard("expense", "EXPENSE", "10"),
      adjustment,
    ];
    expect(accountLedger("a", "100", entries).at(-1)?.balanceAfter).toBe(
      "135.55",
    );
    expect(cashflow(entries)).toEqual({
      income: "20",
      expenses: "10",
      net: "10",
    });
    expect(
      accountLedger("a", "100", [
        { ...adjustment, sourceAccountId: "a", destinationAccountId: null },
      ]).at(-1)?.balanceAfter,
    ).toBe("74.45");
  });
  it("retains prior history and recalculates after backdating or voiding", () => {
    const original = standard("income", "INCOME", "10");
    expect(
      accountLedger("a", "100", [original, adjustment]).map(
        (e) => e.balanceAfter,
      ),
    ).toEqual(["110", "135.55"]);
    const backdated = standard(
      "old",
      "EXPENSE",
      "5",
      "2026-09-01T00:00:00.000Z",
    );
    expect(
      accountLedger("a", "100", [original, adjustment, backdated]).map(
        (e) => e.balanceAfter,
      ),
    ).toEqual(["95", "105", "130.55"]);
    expect(
      accountLedger("a", "100", [
        original,
        { ...adjustment, voidedAt: "2026-09-22T00:00:00Z" },
      ]).at(-1)?.balanceAfter,
    ).toBe("110");
  });
  it.each(["0", "-20.55", "999999999999999.12345678"])(
    "accepts precise balance %s",
    (balance) => {
      expect(
        balanceAdjustmentSchema.safeParse({
          balance,
          expectedBalance: "100",
          clientRequestId: "f1cf3264-620a-4a2c-a17f-caa2476c83c5",
        }).success,
      ).toBe(true);
    },
  );
  it.each(["NaN", "Infinity", "1e3", "1.123456789", "", "1000000000000000"])(
    "rejects invalid balance %s",
    (balance) => {
      expect(
        balanceAdjustmentSchema.safeParse({
          balance,
          expectedBalance: "100",
          clientRequestId: "f1cf3264-620a-4a2c-a17f-caa2476c83c5",
        }).success,
      ).toBe(false);
    },
  );
  it("requires a balance snapshot and rejects user-supplied ownership or timestamps", () => {
    const input = {
      balance: "50",
      expectedBalance: "100",
      clientRequestId: "f1cf3264-620a-4a2c-a17f-caa2476c83c5",
    };
    expect(
      balanceAdjustmentSchema.safeParse({
        ...input,
        expectedBalance: undefined,
      }).success,
    ).toBe(false);
    expect(
      balanceAdjustmentSchema.safeParse({ ...input, userId: "other" }).success,
    ).toBe(false);
    expect(
      balanceAdjustmentSchema.safeParse({
        ...input,
        occurredAt: "2026-09-01T00:00:00Z",
      }).success,
    ).toBe(false);
  });
});
describe("weighted average investment accounting", () => {
  it("includes the buying fee in cost and subtracts selling fees from realized profit", () => {
    const buy = {
      ...trade("buy", "BUY", "0.01", "800", "50"),
      pricePerUnit: "80000",
    };
    const current = portfolio([buy], { asset: "95000" });
    expect(current.positions[0]).toMatchObject({
      costBasis: "850",
      totalInvested: "850",
      marketValue: "950",
      unrealizedGain: "100",
    });
    const sold = portfolio([
      buy,
      {
        ...trade("sell", "SELL", "0.01", "950", "20", "2026-09-16T12:00:00Z"),
        pricePerUnit: "95000",
      },
    ]);
    expect(sold.realizedGain).toBe("80");
    expect(sold.totalFees).toBe("70");
  });
  const buys = [
    trade("1", "BUY", "10", "100", "2"),
    trade("2", "BUY", "10", "200", "2"),
  ];
  it("derives BUY quantity, fees and average acquisition cost", () => {
    const p = portfolio(buys);
    expect(p.positions[0]).toMatchObject({
      quantity: "20",
      costBasis: "304",
      totalInvested: "304",
      averageCost: "15.2",
      fees: "4",
    });
    expect(p.totalFees).toBe("4");
  });
  it("derives SELL realized gain after fees and remaining basis", () =>
    expect(
      portfolio([...buys, trade("3", "SELL", "5", "100", "1")]).positions[0],
    ).toMatchObject({
      quantity: "15",
      costBasis: "228",
      averageCost: "15.2",
      realizedGain: "23",
    }));
  it("calculates current valuation and unrealized gain", () => {
    const p = portfolio(buys, { asset: "20" });
    expect(p.holdingsValue).toBe("400");
    expect(p.positions[0]?.unrealizedGain).toBe("96");
    expect(Number(p.positions[0]?.returnPercent)).toBeCloseTo(31.578947);
  });
  it("does not report missing prices as zero", () => {
    const p = portfolio(buys);
    expect(p.holdingsValue).toBeNull();
    expect(p.positions[0]?.unrealizedGain).toBeNull();
  });
  it("counts standalone fees and net dividends", () => {
    const p = portfolio([
      ...buys,
      trade("3", "FEE", null, "4"),
      trade("4", "DIVIDEND", null, "10", "1"),
    ]);
    expect(p.totalFees).toBe("9");
    expect(p.dividends).toBe("9");
  });
  it("rejects short sales", () =>
    expect(() => portfolio([...buys, trade("3", "SELL", "21", "420")])).toThrow(
      "INSUFFICIENT_HOLDINGS",
    ));
  it("rejects backdated sales before the holdings existed", () =>
    expect(() =>
      portfolio([
        ...buys,
        trade("3", "SELL", "1", "20", "0", "2026-09-01T00:00:00.000Z"),
      ]),
    ).toThrow("INSUFFICIENT_HOLDINGS"));
  it("clears cost basis after full liquidation", () =>
    expect(
      portfolio([...buys, trade("3", "SELL", "20", "400", "1")]).positions[0],
    ).toMatchObject({
      quantity: "0",
      costBasis: "0",
      marketValue: "0",
      realizedGain: "95",
      averageCost: "0",
    }));
});
describe("validation", () => {
  const tx = {
    type: "INCOME",
    categoryId: "salary",
    destinationAccountId: "a",
    amount: "1",
    currency: "EUR",
    occurredAt: "2026-09-01T12:30:45.000Z",
    clientRequestId: "f1cf3264-620a-4a2c-a17f-caa2476c83c5",
  };
  it("normalizes email before validation", () =>
    expect(
      signupSchema.parse({
        firstName: "A",
        lastName: "B",
        email: "  TEST@Example.com ",
        acceptTerms: true,
        termsVersion,
      }).email,
    ).toBe("test@example.com"));
  it("rejects signup role escalation and supplied user IDs", () => {
    const user = {
      firstName: "A",
      lastName: "B",
      email: "a@b.com",
      acceptTerms: true,
      termsVersion,
    };
    expect(signupSchema.safeParse({ ...user, role: "ADMIN" }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...user, userId: "someone" }).success).toBe(
      false,
    );
  });
  it.each([
    "-1",
    "0",
    "NaN",
    "Infinity",
    "1e3",
    "0.000000001",
    "invalid",
    "1.2.3",
  ])("rejects invalid monetary amount %s", (amount) =>
    expect(transactionSchema.safeParse({ ...tx, amount }).success).toBe(false),
  );
  it("requires a full timestamp with offset", () => {
    expect(
      transactionSchema.safeParse({ ...tx, occurredAt: "2026-09-01" }).success,
    ).toBe(false);
    expect(
      transactionSchema.safeParse({ ...tx, occurredAt: "bad" }).success,
    ).toBe(false);
    expect(transactionSchema.safeParse(tx).success).toBe(true);
  });
  it.each(["INCOME", "EXPENSE"])(
    "requires a category for %s, including corrections",
    (type) => {
      const input = {
        ...tx,
        type,
        sourceAccountId: type === "EXPENSE" ? "a" : null,
        destinationAccountId: type === "INCOME" ? "a" : null,
      };
      for (const categoryId of [undefined, null, "", "   "]) {
        expect(
          transactionSchema.safeParse({ ...input, categoryId }).success,
        ).toBe(false);
        expect(
          transactionSchema.safeParse({
            ...input,
            categoryId,
            replacesId: "original",
          }).success,
        ).toBe(false);
      }
      expect(transactionSchema.safeParse(input).success).toBe(true);
    },
  );
  it("allows uncategorized transfers but rejects categorized transfers", () => {
    const input = {
      ...tx,
      type: "TRANSFER",
      sourceAccountId: "a",
      destinationAccountId: "b",
      categoryId: null,
    };
    expect(transactionSchema.safeParse(input).success).toBe(true);
    expect(
      transactionSchema.safeParse({ ...input, categoryId: "salary" }).success,
    ).toBe(false);
  });
  it("rejects transfers to the same account", () =>
    expect(
      transactionSchema.safeParse({
        ...tx,
        type: "TRANSFER",
        sourceAccountId: "a",
        categoryId: null,
      }).success,
    ).toBe(false));
  it("rejects the obsolete broker preset property", () =>
    expect(
      accountSchema.safeParse({
        name: "Cash",
        type: "CASH",
        currency: "EUR",
        initialBalance: "0",
        provider: "COINBASE",
      }).success,
    ).toBe(false));
  it("creates an investment account without a broker preset", () =>
    expect(
      accountSchema.safeParse({
        name: "My portfolio",
        type: "INVESTMENT",
        currency: "EUR",
        initialBalance: "0",
      }).success,
    ).toBe(true));
  it("rejects inconsistent trade amounts", () =>
    expect(
      investmentSchema.safeParse({
        accountId: "a",
        sourceAccountId: "bank",
        assetId: "asset",
        type: "BUY",
        quantity: "2",
        pricePerUnit: "10",
        totalAmount: "21",
        currency: "EUR",
        executedAt: tx.occurredAt,
        clientRequestId: tx.clientRequestId,
      }).success,
    ).toBe(false));
});
describe("localization and refresh", () => {
  it("falls back to English and respects browser quality preferences", () => {
    expect(resolveLocale("fr")).toBe("en");
    expect(resolveLocale("hr-HR")).toBe("hr");
    expect(preferredLocale("fr,en;q=0.5,hr;q=0.9")).toBe("hr");
    expect(preferredLocale("hr;q=0,en;q=1")).toBe("en");
  });
  it("formats Croatian amounts and dates", () => {
    expect(formatMoney("1234.56", "EUR", "hr").replace(/\s/g, " ")).toBe(
      "1.234,56 €",
    );
    expect(formatDate("2026-09-29T12:00:00Z", "hr").replace(/\s/g, " ")).toBe(
      "29. 9. 2026.",
    );
  });
  it("formats English amounts and dates", () => {
    expect(formatMoney("1234.56", "EUR", "en")).toBe("€1,234.56");
    expect(formatDate("2026-09-29T12:00:00Z", "en")).toBe("Sep 29, 2026");
  });
  it("polls at 60 seconds only when visible and online", () => {
    expect(priceRefreshInterval(true, true)).toBe(60000);
    expect(priceRefreshInterval(false, true)).toBe(false);
    expect(priceRefreshInterval(true, false)).toBe(false);
  });
});
