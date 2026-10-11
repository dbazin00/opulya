import { describe, expect, it } from "vitest";
import { priceRefreshInterval } from "./price-refresh";
describe("database-only price refresh cadence", () => {
  const pending = { assetId: "a", quote: null, error: "MARKET_PRICE_PENDING" };
  it("checks quickly for the first minute, then backs off", () => {
    const state = new Map<string, number>();
    expect(priceRefreshInterval([pending], state, 1000)).toBe(2000);
    expect(priceRefreshInterval([pending], state, 60999)).toBe(2000);
    expect(priceRefreshInterval([pending], state, 61000)).toBe(60000);
  });
  it("also checks quickly when a refresh is queued while a cached price stays visible", () => {
    const state = new Map<string, number>();
    const queued = {
      assetId: "cached",
      quote: { price: "123" },
      error: null,
      refreshPending: true,
    };
    expect(priceRefreshInterval([queued], state, 1000)).toBe(2000);
    expect(priceRefreshInterval([queued], state, 61000)).toBe(60000);
    expect(
      priceRefreshInterval(
        [{ ...queued, refreshPending: false }],
        state,
        62000,
      ),
    ).toBe(60000);
    expect(state.size).toBe(0);
  });
  it("slows down for ready, failed, missing-key and fully sold positions", () => {
    for (const item of [
      { ...pending, quote: { price: "123" }, error: null },
      { ...pending, error: "MARKET_NOT_CONFIGURED" },
      { ...pending, error: "MARKET_RATE_LIMIT" },
      { ...pending, error: null },
    ])
      expect(priceRefreshInterval([item], new Map(), 1000)).toBe(60000);
  });
  it("clears completed pending windows and restarts for a newly pending asset", () => {
    const state = new Map<string, number>();
    priceRefreshInterval([pending], state, 1000);
    expect(priceRefreshInterval([], state, 100000)).toBe(60000);
    expect(state.size).toBe(0);
    expect(priceRefreshInterval([pending], state, 200000)).toBe(2000);
  });
});
