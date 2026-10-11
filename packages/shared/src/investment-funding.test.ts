import { describe, expect, it } from "vitest";
import {
  accountLedger,
  cashflow,
  portfolio,
  type InvestmentEntry,
  type LedgerTransaction,
} from "./finance.js";
import { investmentSchema } from "./validation.js";

const timestamp = "2026-09-15T12:00:00.000Z";
const transfer: LedgerTransaction = {
  id: "funding",
  type: "TRANSFER",
  amount: "102.25",
  sourceAccountId: "bank",
  destinationAccountId: "investment",
  occurredAt: timestamp,
  createdAt: timestamp,
};
const buy: InvestmentEntry = {
  id: "buy",
  accountId: "investment",
  assetId: "asset",
  type: "BUY",
  quantity: "10",
  pricePerUnit: "10",
  totalAmount: "100",
  fee: "2.25",
  executedAt: timestamp,
  createdAt: timestamp,
  fundingTransactionId: "funding",
};
const input = {
  accountId: "investment",
  sourceAccountId: "bank",
  assetId: "asset",
  type: "BUY",
  quantity: "10",
  pricePerUnit: "10",
  totalAmount: "100",
  fee: "2.25",
  currency: "EUR",
  executedAt: timestamp,
  clientRequestId: "3f41770f-3a70-4e81-8464-7eb984780f3b",
};

describe("linked investment funding", () => {
  it("accepts correction references but rejects supplied ledger-order timestamps", () => {
    expect(
      investmentSchema.safeParse({ ...input, replacesId: "original" }).success,
    ).toBe(true);
    expect(
      investmentSchema.safeParse({ ...input, ledgerOrderAt: timestamp })
        .success,
    ).toBe(false);
  });
  it("preserves a corrected purchase's ordering ahead of a same-timestamp sale", () => {
    const originalCreatedAt = "2026-09-15T12:01:00.000Z";
    const replacement = {
      ...buy,
      id: "replacement",
      createdAt: "2026-09-15T12:03:00.000Z",
      ledgerOrderAt: originalCreatedAt,
    };
    const sale: InvestmentEntry = {
      ...buy,
      id: "sale",
      fundingTransactionId: null,
      type: "SELL",
      quantity: "5",
      totalAmount: "50",
      fee: "0",
      createdAt: "2026-09-15T12:02:00.000Z",
    };
    expect(portfolio([sale, replacement]).positions).toMatchObject([
      { quantity: "5" },
    ]);
    const correctedFunding = {
      ...transfer,
      createdAt: replacement.createdAt,
      ledgerOrderAt: originalCreatedAt,
    };
    const later = {
      ...transfer,
      id: "later",
      amount: "20",
      destinationAccountId: "savings",
      createdAt: sale.createdAt,
    };
    expect(
      accountLedger(
        "bank",
        "1000",
        [later, correctedFunding],
        [replacement],
      ).map((entry) => entry.id),
    ).toEqual(["funding", "later"]);
  });
  it("debits source including fees and groups destination without changing cash", () => {
    expect(accountLedger("bank", "1000", [transfer], [buy])).toMatchObject([
      { id: "funding", delta: "-102.25", balanceAfter: "897.75" },
    ]);
    expect(accountLedger("investment", "20", [transfer], [buy])).toMatchObject([
      { id: "buy", kind: "INVESTMENT", delta: "0", balanceAfter: "20" },
    ]);
    expect(portfolio([buy], { asset: "12" }).positions[0]).toMatchObject({
      quantity: "10",
      averageCost: "10.225",
      unrealizedGain: "17.75",
    });
  });
  it("credits a funded deposit exactly once, without creating holdings", () => {
    const deposit = {
      ...buy,
      type: "DEPOSIT" as const,
      assetId: null,
      quantity: null,
      pricePerUnit: null,
      totalAmount: "102.25",
      fee: "0",
    };
    expect(
      accountLedger("investment", "20", [transfer], [deposit]),
    ).toMatchObject([{ id: "buy", delta: "102.25", balanceAfter: "122.25" }]);
    expect(portfolio([deposit]).positions).toEqual([]);
    expect(cashflow([transfer])).toEqual({
      income: "0",
      expenses: "0",
      net: "0",
    });
  });
  it("retains historical unlinked deposit and purchase balances", () => {
    expect(
      accountLedger(
        "investment",
        "200",
        [],
        [{ ...buy, fundingTransactionId: null }],
      )[0]?.balanceAfter,
    ).toBe("97.75");
    expect(
      accountLedger(
        "investment",
        "20",
        [],
        [{ ...buy, type: "DEPOSIT", fee: "0", fundingTransactionId: null }],
      )[0]?.balanceAfter,
    ).toBe("120");
  });
  it("recalculates subsequent source balances after historical funding insertion", () => {
    const expense = {
      ...transfer,
      id: "later",
      type: "EXPENSE" as const,
      destinationAccountId: null,
      amount: "10",
      occurredAt: "2026-09-20T12:00:00.000Z",
    };
    expect(
      accountLedger("bank", "1000", [expense, transfer], [buy]).map(
        (row) => row.balanceAfter,
      ),
    ).toEqual(["897.75", "887.75"]);
  });
  it("ignores both voided records", () => {
    expect(
      accountLedger(
        "bank",
        "1000",
        [{ ...transfer, voidedAt: timestamp }],
        [{ ...buy, voidedAt: timestamp }],
      ),
    ).toEqual([]);
    expect(
      accountLedger(
        "investment",
        "20",
        [{ ...transfer, voidedAt: timestamp }],
        [{ ...buy, voidedAt: timestamp }],
      ),
    ).toEqual([]);
  });
  it("does not group an unrelated transfer", () => {
    expect(
      accountLedger(
        "investment",
        "20",
        [{ ...transfer, id: "other" }],
        [{ ...buy, fundingTransactionId: null }],
      ),
    ).toHaveLength(2);
  });
  it("requires real account funding for new buys and deposits", () => {
    expect(investmentSchema.safeParse(input).success).toBe(true);
    expect(
      investmentSchema.safeParse({ ...input, sourceAccountId: null }).success,
    ).toBe(false);
    expect(
      investmentSchema.safeParse({ ...input, sourceAccountId: undefined })
        .success,
    ).toBe(false);
    const deposit = {
      ...input,
      type: "DEPOSIT",
      assetId: null,
      quantity: null,
      pricePerUnit: null,
      fee: "0",
    };
    expect(investmentSchema.safeParse(deposit).success).toBe(true);
    expect(
      investmentSchema.safeParse({ ...deposit, sourceAccountId: null }).success,
    ).toBe(false);
  });
  it("rejects self-funding and funding a sale", () => {
    expect(
      investmentSchema.safeParse({ ...input, sourceAccountId: input.accountId })
        .success,
    ).toBe(false);
    expect(investmentSchema.safeParse({ ...input, type: "SELL" }).success).toBe(
      false,
    );
  });
  it("precisely combines fractional purchase amounts and fees", () => {
    const fractional = {
      ...input,
      quantity: "1",
      pricePerUnit: "0.1",
      totalAmount: "0.1",
      fee: "0.2",
    };
    expect(investmentSchema.safeParse(fractional).success).toBe(true);
    const activity = {
      ...buy,
      quantity: "1",
      pricePerUnit: "0.1",
      totalAmount: "0.1",
      fee: "0.2",
    };
    const funding = { ...transfer, amount: "0.3" };
    expect(
      accountLedger("bank", "1000", [funding], [activity])[0]?.balanceAfter,
    ).toBe("999.7");
    expect(
      accountLedger("investment", "20", [funding], [activity])[0]?.balanceAfter,
    ).toBe("20");
  });
});
