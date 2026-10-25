import { describe, expect, it } from "vitest";
import {
  accountSchema,
  assetSchema,
  budgetQuerySchema,
  budgetWriteSchema,
  currencies,
  currencySchema,
  filterSchema,
  investmentSchema,
  transactionSchema,
} from "./validation.js";

describe("built-in currencies", () => {
  it("uses the runtime catalogue without a maintained whitelist", () => {
    expect(currencies).toEqual(Intl.supportedValuesOf("currency"));
    expect(Object.isFrozen(currencies)).toBe(true);
    for (const currency of currencies)
      expect(currencySchema.parse(currency)).toBe(currency);
  });

  it.each(["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "JPY"])(
    "preserves the previously supported currency %s",
    (currency) => {
      expect(currencySchema.parse(currency)).toBe(currency);
    },
  );

  it.each(["PLN", "SEK", "NOK", "DKK", "CZK", "INR", "BHD"])(
    "accepts %s throughout financial input and report schemas",
    (currency) => {
      expect(
        accountSchema.parse({
          name: "Account",
          type: "BANK",
          currency,
          initialBalance: "0",
        }).currency,
      ).toBe(currency);
      expect(
        transactionSchema.parse({
          type: "INCOME",
          destinationAccountId: "account",
          categoryId: "salary",
          amount: "10",
          currency,
          occurredAt: "2025-01-01T12:00:00.000Z",
          clientRequestId: "00b13e4a-7581-4ba7-8f27-9d09a83211ef",
        }).currency,
      ).toBe(currency);
      expect(
        investmentSchema.parse({
          accountId: "portfolio",
          type: "FEE",
          totalAmount: "1",
          currency,
          executedAt: "2025-01-01T12:00:00.000Z",
          clientRequestId: "00b13e4a-7581-4ba7-8f27-9d09a83211ef",
        }).currency,
      ).toBe(currency);
      expect(
        assetSchema.parse({
          symbol: "TEST",
          name: "Test listing",
          assetType: "STOCK",
          exchange: "EXCHANGE",
          currency,
        }).currency,
      ).toBe(currency);
      expect(
        budgetWriteSchema.parse({
          categoryId: "food",
          currency,
          month: "2025-01",
          scope: "RECURRING",
          amount: "10",
        }).currency,
      ).toBe(currency);
      expect(
        budgetQuerySchema.parse({ month: "2025-01", currency }).currency,
      ).toBe(currency);
      expect(filterSchema.parse({ currency }).currency).toBe(currency);
    },
  );

  it.each(["XYZ", "BTC", "ETH", "GBX", "usd", " EUR ", "EURO", "", null, 123])(
    "rejects unrecognized or malformed currency %j",
    (currency) => {
      expect(currencySchema.safeParse(currency).success).toBe(false);
    },
  );

  it("keeps EUR as the default reporting currency", () => {
    expect(filterSchema.parse({}).currency).toBe("EUR");
    expect(budgetQuerySchema.parse({ month: "2025-01" }).currency).toBe("EUR");
  });
});
