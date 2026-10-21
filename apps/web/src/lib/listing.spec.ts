import { describe, expect, it } from "vitest";
import { listingExchange } from "./listing";

describe("broker-independent listing labels", () => {
  it("uses venue identity rather than fund name or ticker suffix", () => {
    expect(
      listingExchange({
        assetType: "ETF",
        exchange: "AMS",
        mic: "XAMS",
        exchangeName: "Amsterdam",
      }),
    ).toBe("Euronext Amsterdam");
    expect(
      listingExchange({
        assetType: "ETF",
        exchange: "CXE",
        exchangeName: "Cboe Europe",
      }),
    ).toBe("Cboe Europe (CXE)");
  });
  it("preserves unknown venues without guessing and never assigns crypto a broker", () => {
    expect(
      listingExchange({ assetType: "FUND", exchange: "Unknown venue" }),
    ).toBe("Unknown venue");
    expect(listingExchange({ assetType: "STOCK", exchange: "" })).toBeNull();
    expect(
      listingExchange({
        assetType: "CRYPTO",
        exchange: "CCC",
        exchangeName: "Crypto",
      }),
    ).toBeNull();
  });
});
