import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { directorySchema } from "./instrument-directory.js";

describe("catalogue search input", () => {
  it.each([
    "iShares Core MSCI World",
    "IWDA.AS",
    "BTC/EUR",
    "S&P 500",
    "IE00B4L5Y983",
    "IE00B4L5Y984",
    "LIVE12345678",
  ])("accepts free-text search: %s", (search) =>
    expect(directorySchema.parse({ search }).search).toBe(search),
  );
  it("trims search and keeps bounded, validated filters", () => {
    expect(directorySchema.parse({ search: "  Bitcoin  " })).toMatchObject({
      search: "Bitcoin",
      currency: "EUR",
      page: 0,
    });
    for (const query of [
      { search: "x".repeat(81) },
      { currency: "GBX" },
      { page: -1 },
      { userId: "injected" },
      { exchange: "AEB" },
    ])
      expect(directorySchema.safeParse(query).success).toBe(false);
  });
});
