import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarketPriceSync,
  InstrumentProvider,
  InstrumentsService,
  dailyCycle,
  instrumentIdentity,
  searchInstrument,
  catalogueChoices,
  exactCryptoChoices,
} from "./instruments.js";
import { MarketDataService } from "./market.js";
import type { Database } from "./db.js";
import type { Asset, Instrument } from "./generated/prisma/client.js";

const instrument: Instrument = {
  id: "i",
  name: "Example stock",
  symbol: "EXM",
  assetType: "STOCK",
  exchange: "NASDAQ",
  mic: "XNAS",
  currency: "USD",
  timeZone: "America/New_York",
  isin: null,
  identity: "identity",
  createdAt: new Date(),
};
const asset: Asset = {
  ...instrument,
  userId: "u",
  marketDataIdentifier: "EXM",
  instrumentId: "i",
  updatedAt: new Date(),
};
const search = {
  symbol: "EXM",
  instrument_name: "Example stock",
  instrument_type: "Common Stock",
  exchange: "NASDAQ",
  mic_code: "XNAS",
  currency: "USD",
  exchange_timezone: "America/New_York",
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("instrument identities and discovery", () => {
  it("prefers the exact coin name or ticker instead of related coins", () => {
    const rows = [
      { name: "Bitcoin", symbol: "BTC/EUR" },
      { name: "Bitcoin Cash", symbol: "BCH/EUR" },
      { name: "Wrapped Bitcoin", symbol: "WBTC/EUR" },
    ];
    expect(exactCryptoChoices(rows, "bitcoin")).toEqual([rows[0]]);
    expect(exactCryptoChoices(rows, "BTC")).toEqual([rows[0]]);
    expect(exactCryptoChoices(rows, "bit")).toEqual(rows);
  });
  it("shows one crypto pair across sources but keeps currencies, coins and stock exchanges separate", () => {
    const btc = {
      ...instrument,
      symbol: "BTC/EUR",
      assetType: "CRYPTO" as const,
      currency: "EUR",
      exchange: "Kraken",
      mic: "",
    };
    const preferred = { ...btc, id: "binance", exchange: "Binance" };
    const usd = { ...btc, id: "usd", symbol: "BTC/USD", currency: "USD" };
    const other = { ...btc, id: "eth", symbol: "ETH/EUR" };
    const stock = { ...instrument, id: "stock" };
    const otherStock = {
      ...stock,
      id: "stock-lse",
      exchange: "LSE",
      mic: "XLON",
    };
    expect(
      catalogueChoices([btc, usd, stock, preferred, other, otherStock]),
    ).toEqual([preferred, usd, stock, other, otherStock]);
    expect(catalogueChoices([preferred, btc])[0]).toBe(preferred);
  });
  it("reuses a private crypto asset across platform variants without rewriting it", async () => {
    const btc = {
      ...instrument,
      symbol: "BTC/EUR",
      assetType: "CRYPTO" as const,
      exchange: "Kraken",
      currency: "EUR",
      mic: "",
    };
    const preferred = { ...btc, id: "preferred", exchange: "Binance" };
    const owned = {
      ...asset,
      assetType: "CRYPTO",
      id: "owned",
      instrumentId: btc.id,
      currency: "EUR",
      name: "Private Bitcoin label",
    };
    const db = {
      instrument: {
        findFirst: vi.fn().mockResolvedValue(btc),
        findMany: vi.fn().mockResolvedValue([btc, preferred]),
      },
      asset: { findFirst: vi.fn().mockResolvedValue(owned), upsert: vi.fn() },
    };
    const service = new InstrumentsService(
      db as unknown as Database,
      {} as InstrumentProvider,
    );
    expect(await service.select("user-a", preferred.id)).toBe(owned);
    expect(db.asset.findFirst).toHaveBeenCalledOnce();
    expect(db.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-a" }),
      }),
    );
    expect(db.asset.upsert).not.toHaveBeenCalled();
  });
  it("keeps exchange, MIC, currency and asset class distinct", () => {
    const key = instrumentIdentity(instrument);
    for (const input of [
      { exchange: "NYSE" },
      { mic: "XNYS" },
      { currency: "EUR" },
      { assetType: "ETF" as const },
    ])
      expect(instrumentIdentity({ ...instrument, ...input })).not.toBe(key);
  });
  it("takes structured metadata from the provider, not user-entered identifiers", () => {
    expect(searchInstrument(search)).toMatchObject({
      symbol: "EXM",
      mic: "XNAS",
      currency: "USD",
      timeZone: "America/New_York",
    });
    expect(
      searchInstrument({ ...search, instrument_type: "Unknown type" }),
    ).toBeNull();
    expect(searchInstrument({ ...search, currency: "GBX" })).toBeNull();
    expect(
      searchInstrument({ ...search, exchange_timezone: "invalid" }),
    ).toBeNull();
  });
  it("supports explicit crypto pairs but rejects ambiguous crypto tickers", () => {
    expect(
      searchInstrument({
        ...search,
        symbol: "BTC/EUR",
        instrument_type: "Digital Currency",
        currency: "",
        mic_code: "",
        exchange: "",
        exchange_timezone: "UTC",
      }),
    ).toMatchObject({ currency: "EUR", assetType: "CRYPTO" });
    expect(
      searchInstrument({
        ...search,
        symbol: "BTC",
        instrument_type: "Digital Currency",
        currency: "EUR",
      }),
    ).toBeNull();
  });
  it("deduplicates discovery and caches results across repeated searches", async () => {
    const external = { search: vi.fn().mockResolvedValue([]) };
    const service = new InstrumentsService(
      {} as Database,
      external as unknown as InstrumentProvider,
    );
    await Promise.all([service.discover("EXM"), service.discover("EXM")]);
    await service.discover("exm");
    expect(external.search).toHaveBeenCalledOnce();
  });
});
describe("database-only latest valuation", () => {
  function stored(
    price: unknown = {
      price: { toString: () => "123.45" },
      currency: "USD",
      provider: "Alpha Vantage",
      tradingDate: new Date("2026-09-29"),
      availableAt: new Date("2026-09-30T04:00:00Z"),
      fetchedAt: new Date(),
    },
    error: string | null = null,
  ) {
    const db = {
      instrument: { findUnique: vi.fn().mockResolvedValue(null) },
      latestPrice: { findUnique: vi.fn().mockResolvedValue(price) },
      instrumentMapping: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ lastSuccessAt: new Date(), error }),
      },
    };
    return { db, service: new MarketDataService(db as unknown as Database) };
  }
  it("reads a single saved price without making any external request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { service, db } = stored();
    expect((await service.getCurrentPrice(asset)).quote).toMatchObject({
      price: "123.45",
      tradingDate: "2026-09-29",
    });
    expect(db.latestPrice.findUnique).toHaveBeenCalledWith({
      where: { instrumentId: asset.instrumentId },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    "MARKET_UNAVAILABLE",
    "MARKET_PLAN_REQUIRED",
    "MARKET_SYMBOL_NOT_FOUND",
  ])(
    "retains a saved price and its timestamp when a refresh fails: %s",
    async (error) => {
      const { service } = stored(undefined, error);
      expect(await service.getCurrentPrice(asset)).toMatchObject({
        quote: { price: "123.45", stale: true, tradingDate: "2026-09-29" },
        error,
      });
    },
  );
  it("returns a plan restriction for an unpriced asset without pretending it is still loading", async () => {
    expect(
      await stored(null, "MARKET_PLAN_REQUIRED").service.getCurrentPrice(asset),
    ).toEqual({ quote: null, error: "MARKET_PLAN_REQUIRED" });
  });
  it("makes a missing current price explicit rather than inventing zero", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "fixture-not-a-real-key");
    expect((await stored(null).service.getCurrentPrice(asset)).error).toBe(
      "MARKET_PRICE_PENDING",
    );
  });
  it("reports missing configuration instead of pretending a first price is being fetched", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    expect((await stored(null).service.getCurrentPrice(asset)).error).toBe(
      "MARKET_NOT_CONFIGURED",
    );
  });
  it("rejects a price whose completed close is not yet available", async () => {
    const { service } = stored({
      price: { toString: () => "123.45" },
      currency: "USD",
      provider: "Alpha Vantage",
      tradingDate: new Date(),
      availableAt: new Date(Date.now() + 86400000),
      fetchedAt: new Date(),
    });
    expect((await service.getCurrentPrice(asset)).quote).toBeNull();
  });
  it("rejects a saved price in the wrong currency", async () => {
    const { service } = stored({
      price: { toString: () => "123.45" },
      currency: "EUR",
      provider: "Alpha Vantage",
      tradingDate: new Date("2026-09-29"),
      availableAt: new Date("2026-09-30"),
      fetchedAt: new Date(),
    });
    expect((await service.getCurrentPrice(asset)).error).toBe(
      "MARKET_IDENTITY_MISMATCH",
    );
  });
});
describe("scheduler boundaries", () => {
  it("uses a daily 12:00 UTC cycle", () => {
    expect(dailyCycle(new Date("2026-10-07T11:59:00Z")).toISOString()).toBe(
      "2026-10-06T12:00:00.000Z",
    );
    expect(dailyCycle(new Date("2026-10-07T12:00:00Z")).toISOString()).toBe(
      "2026-10-07T12:00:00.000Z",
    );
  });
  it("does not start a job without a key", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    expect(
      await new MarketPriceSync(
        {} as Database,
        {} as InstrumentsService,
        {} as InstrumentProvider,
      ).run(),
    ).toMatchObject({ skipped: "MARKET_NOT_CONFIGURED" });
  });
});
