import { describe, expect, it } from "vitest";
import {
  findVenue,
  listingVenue,
  validIsin,
  isinSchema,
} from "./instrument-metadata.js";

describe("instrument metadata", () => {
  it("displays known exchange names without requiring a broker selection", () => {
    for (const alias of [
      "AEB",
      "AMS",
      "XAMS",
      "Amsterdam",
      "Euronext Amsterdam",
    ])
      expect(findVenue(alias)?.name).toBe("Euronext Amsterdam");
    for (const alias of ["IBIS2", "GER", "XETRA", "XETR"])
      expect(findVenue(alias)?.id).toBe("XETR");
    expect(findVenue("SMART")).toBeNull();
    expect(findVenue("Europe")).toBeNull();
  });
  it("uses MIC, exchange code and exchange name without inferring from a ticker", () => {
    expect(
      listingVenue({ assetType: "ETF", mic: "XAMS", exchange: "AMS" })?.id,
    ).toBe("XAMS");
    expect(listingVenue({ assetType: "STOCK", exchange: "NMS" })?.id).toBe(
      "XNAS",
    );
    expect(
      listingVenue({ assetType: "ETF", exchange: "", exchangeName: "Xetra" })
        ?.id,
    ).toBe("XETR");
    expect(
      listingVenue({ assetType: "ETF", exchange: "Unknown exchange" }),
    ).toBeNull();
    expect(
      listingVenue({ assetType: "CRYPTO", exchange: "Coinbase" }),
    ).toBeNull();
  });
  it("validates provider-supplied ISIN metadata, not free-text search", () => {
    expect(validIsin("IE00B4L5Y983")).toBe(true);
    expect(validIsin("DE000A0S9GB0")).toBe(true);
    expect(validIsin("IE00B4L5Y984")).toBe(false);
    expect(validIsin("Bitcoin")).toBe(false);
    expect(isinSchema.parse(" ie00b4l5y983 ")).toBe("IE00B4L5Y983");
    expect(isinSchema.safeParse("IE00B4L5Y984").success).toBe(false);
  });
});
