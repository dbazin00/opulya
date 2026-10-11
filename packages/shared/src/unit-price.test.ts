import { describe, expect, it } from "vitest";
import { formatMoney } from "./locale.js";
describe("localized unit prices", () => {
  it("shows small crypto unit prices without rounding them to zero", () => {
    expect(formatMoney("0.00000001", "EUR", "en", 8)).toBe("€0.00000001");
    expect(formatMoney("0.00000001", "EUR", "hr", 8)).toMatch(
      /^0,00000001\s€$/,
    );
  });
  it("preserves a decimal string beyond JavaScript's safe integer range", () => {
    expect(formatMoney("1234567890123456.12345678", "EUR", "en", 8)).toBe(
      "€1,234,567,890,123,456.12345678",
    );
  });
  it("keeps the usual currency precision for balances and totals", () => {
    expect(formatMoney("123.456789", "EUR", "en")).toBe("€123.46");
    expect(formatMoney("123.456789", "EUR", "hr")).toMatch(/^123,46\s€$/);
    expect(formatMoney("95000", "EUR", "en", 8)).toBe("€95,000.00");
  });
  it("uses currency minor units rather than forcing two decimals", () => {
    expect(formatMoney("123.6", "JPY", "en")).toMatch(/124$/);
    expect(formatMoney("123.6", "JPY", "hr")).toMatch(/^124\s[^\d]+$/);
  });
});
