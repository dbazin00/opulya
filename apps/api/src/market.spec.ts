import { describe, expect, it } from "vitest";
import { marketDataSymbol } from "./market.js";
import type { Asset } from "./generated/prisma/client.js";

const asset = {
  symbol: "BTC",
  assetType: "CRYPTO",
  currency: "EUR",
  marketDataIdentifier: null,
} as Asset;
describe("market item identifiers", () => {
  it("resolves a bare crypto ticker to its valuation currency", () => {
    expect(marketDataSymbol(asset)).toBe("BTC/EUR");
    expect(marketDataSymbol({ ...asset, currency: "USD" })).toBe("BTC/USD");
  });
  it("keeps an exact crypto pair and provider identifier", () => {
    expect(
      marketDataSymbol({ ...asset, marketDataIdentifier: "eth/eur" }),
    ).toBe("ETH/EUR");
  });
  it("does not change the listing symbol of a stock or ETF", () => {
    expect(
      marketDataSymbol({ ...asset, assetType: "STOCK", symbol: "AAPL" }),
    ).toBe("AAPL");
    expect(
      marketDataSymbol({
        ...asset,
        assetType: "ETF",
        symbol: "VWCE",
        marketDataIdentifier: "VWCE.XETR",
      }),
    ).toBe("VWCE.XETR");
  });
});
