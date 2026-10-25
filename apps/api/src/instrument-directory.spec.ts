import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import {
  candidateId,
  directorySchema,
  InstrumentDirectory,
} from "./instrument-directory.js";
import type {
  InstrumentInput,
  InstrumentProvider,
  InstrumentsService,
} from "./instruments.js";

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

describe("catalogue currency selection", () => {
  it.each(["EUR", "PLN", "SEK", "NOK", "CZK", "INR"])(
    "resolves a verified candidate priced in %s",
    async (currency) => {
      const row: InstrumentInput = {
        name: "Example fund",
        symbol: "EXM",
        assetType: "ETF",
        exchange: "EXCHANGE",
        mic: "",
        currency,
        timeZone: "Europe/Zagreb",
        isin: null,
      };
      const resolve = vi.fn().mockResolvedValue(row);
      const remember = vi.fn().mockResolvedValue({ id: "verified-instrument" });
      const directory = new InstrumentDirectory(
        { resolve } as unknown as InstrumentProvider,
        { remember } as unknown as InstrumentsService,
      );
      expect(directorySchema.parse({ currency }).currency).toBe(currency);
      await expect(directory.resolve(candidateId(row))).resolves.toBe(
        "verified-instrument",
      );
      expect(resolve).toHaveBeenCalledWith("EXM", currency, "ETF");
      expect(remember).toHaveBeenCalledWith(row);
    },
  );

  it.each(["XYZ", "GBX", "BTC", "usd", "EURO"])(
    "rejects candidate currency %s before contacting the provider",
    async (currency) => {
      const resolve = vi.fn();
      const remember = vi.fn();
      const directory = new InstrumentDirectory(
        { resolve } as unknown as InstrumentProvider,
        { remember } as unknown as InstrumentsService,
      );
      await expect(directory.resolve(`yf:ETF:${currency}:EXM`)).rejects.toThrow(
        "NOT_FOUND",
      );
      expect(resolve).not.toHaveBeenCalled();
      expect(remember).not.toHaveBeenCalled();
    },
  );
});
