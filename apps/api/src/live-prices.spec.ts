import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketDataService } from "./market.js";
import { InstrumentsService, InstrumentProvider } from "./instruments.js";
import type { Database } from "./db.js";
import type {
  Asset,
  Instrument,
  InstrumentMapping,
} from "./generated/prisma/client.js";
import type { ProviderPrice } from "./yahoo-finance.js";

const now = new Date("2026-10-21T12:00:00Z");
const instrument: Instrument = {
  id: "i",
  name: "Public ETF",
  symbol: "EXM.AS",
  assetType: "ETF",
  exchange: "AMS",
  exchangeName: "Amsterdam",
  mic: "XAMS",
  currency: "EUR",
  timeZone: "Europe/Amsterdam",
  isin: null,
  identity: "identity",
  createdAt: now,
};
const asset: Asset = {
  id: "a",
  userId: "user-a",
  name: "Private label",
  symbol: instrument.symbol,
  assetType: "ETF",
  exchange: "AMS",
  currency: "EUR",
  instrumentId: "i",
  marketDataIdentifier: instrument.symbol,
  createdAt: now,
  updatedAt: now,
};
const mapping: InstrumentMapping = {
  id: "m",
  instrumentId: "i",
  provider: "Yahoo Finance",
  symbol: instrument.symbol,
  exchange: "AMS",
  mic: "XAMS",
  currency: "EUR",
};
const price = (changes: Partial<ProviderPrice> = {}): ProviderPrice => ({
  price: "123.45678901",
  currency: "EUR",
  kind: "QUOTE",
  provider: "Yahoo Finance",
  fetchedAt: new Date(),
  marketAt: new Date(),
  delayMinutes: 15,
  marketState: "REGULAR",
  ...changes,
});
function fixture() {
  const current = vi.fn(async (): Promise<ProviderPrice> => price());
  const db = {
    instrumentMapping: {
      findUnique: vi.fn().mockResolvedValue({ ...mapping, instrument }),
    },
    instrument: { findUnique: vi.fn().mockResolvedValue(null) },
    asset: { findFirst: vi.fn().mockResolvedValue(asset) },
  };
  const links = { linkLegacy: vi.fn() };
  const service = new MarketDataService(
    db as unknown as Database,
    { current } as unknown as InstrumentProvider,
    links as unknown as InstrumentsService,
  );
  return { db, links, current, service };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  vi.stubEnv("MARKET_DATA_ENABLED", "true");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("on-demand process-local quotes", () => {
  it("fetches the first quote on demand, preserving precision, source time and delay", async () => {
    const { service, current } = fixture();
    expect(await service.getCurrentPrice(asset)).toMatchObject({
      quote: {
        price: "123.45678901",
        marketAt: now.toISOString(),
        fetchedAt: now.toISOString(),
        delayed: true,
        delayMinutes: 15,
        stale: false,
        kind: "QUOTE",
      },
      error: null,
    });
    expect(current).toHaveBeenCalledOnce();
  });
  it("shares one in-flight request and cached public quote across users", async () => {
    const { service, current } = fixture();
    const values = await Promise.all([
      service.getCurrentPrice(asset),
      service.getCurrentPrice({
        ...asset,
        id: "b",
        userId: "user-b",
        name: "Other private label",
      }),
    ]);
    expect(values[0]).toEqual(values[1]);
    await service.getCurrentPrice(asset);
    expect(current).toHaveBeenCalledOnce();
    expect(JSON.stringify(values)).not.toContain("Private label");
  });
  it("expires after a minute and returns the changed price", async () => {
    const { service, current } = fixture();
    await service.getCurrentPrice(asset);
    vi.setSystemTime(new Date(now.getTime() + 59_999));
    await service.getCurrentPrice(asset);
    expect(current).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(now.getTime() + 60_001));
    current.mockResolvedValue(price({ price: "125" }));
    expect((await service.getCurrentPrice(asset)).quote?.price).toBe("125");
    expect(current).toHaveBeenCalledTimes(2);
  });
  it.each(["MARKET_RATE_LIMIT", "MARKET_UNAVAILABLE", "MARKET_AUTH_FAILED"])(
    "keeps last good timestamps, marks stale and backs off after %s",
    async (code) => {
      const { service, current } = fixture();
      await service.getCurrentPrice(asset);
      vi.setSystemTime(new Date(now.getTime() + 60_001));
      current.mockRejectedValue(new Error(code));
      expect(await service.getCurrentPrice(asset)).toMatchObject({
        quote: {
          price: "123.45678901",
          fetchedAt: now.toISOString(),
          stale: true,
        },
        error: code,
      });
      await service.getCurrentPrice(asset);
      expect(current).toHaveBeenCalledTimes(2);
      vi.setSystemTime(new Date(now.getTime() + 120_002));
      current.mockResolvedValue(price({ price: "124" }));
      expect(await service.getCurrentPrice(asset)).toMatchObject({
        quote: { price: "124", stale: false },
        error: null,
      });
    },
  );
  it("does not keep stale fallbacks indefinitely", async () => {
    const { service, current } = fixture();
    await service.getCurrentPrice(asset);
    vi.setSystemTime(new Date(now.getTime() + 24 * 3600_000 + 1));
    current.mockRejectedValue(new Error("MARKET_UNAVAILABLE"));
    expect(await service.getCurrentPrice(asset)).toEqual({
      quote: null,
      error: "MARKET_UNAVAILABLE",
    });
  });
  it.each(["MARKET_SYMBOL_NOT_FOUND", "MARKET_IDENTITY_MISMATCH"])(
    "does not hide %s behind an old quote",
    async (code) => {
      const { service, current } = fixture();
      await service.getCurrentPrice(asset);
      vi.setSystemTime(new Date(now.getTime() + 60_001));
      current.mockRejectedValue(new Error(code));
      expect(await service.getCurrentPrice(asset)).toEqual({
        quote: null,
        error: code,
      });
    },
  );
  it.each([
    { currency: "USD" },
    { provider: "Other source" },
    { price: "-1" },
    { price: "0" },
    { price: "not-a-price" },
    { price: "NaN" },
    { price: "Infinity" },
    { kind: "CLOSE" as const },
    { fetchedAt: new Date(now.getTime() + 1000) },
    { marketAt: new Date(now.getTime() + 1000) },
  ])("rejects invalid quote metadata or values: %o", async (changes) => {
    const { service, current } = fixture();
    current.mockResolvedValue({ ...price(), ...changes } as ProviderPrice);
    expect(await service.getCurrentPrice(asset)).toEqual({
      quote: null,
      error: "MARKET_IDENTITY_MISMATCH",
    });
  });
  it("does not invent zero or expose provider details when a first request fails", async () => {
    const { service, current } = fixture();
    current.mockRejectedValue(new Error("secret from provider"));
    expect(await service.getCurrentPrice(asset)).toEqual({
      quote: null,
      error: "MARKET_UNAVAILABLE",
    });
  });
  it("treats a recent closed-market price as the last available quote, not a fetch failure", async () => {
    const { service, current } = fixture();
    current.mockResolvedValue(
      price({
        marketAt: new Date(now.getTime() - 3 * 86400_000),
        marketState: "CLOSED",
        delayMinutes: 0,
      }),
    );
    expect((await service.getCurrentPrice(asset)).quote).toMatchObject({
      stale: false,
      delayed: false,
      marketState: "CLOSED",
    });
  });
  it("flags unexpectedly old open-market data even after a successful fetch", async () => {
    const { service, current } = fixture();
    current.mockResolvedValue(
      price({ marketAt: new Date(now.getTime() - 3600_000) }),
    );
    expect((await service.getCurrentPrice(asset)).quote?.stale).toBe(true);
  });
  it("loses only disposable prices on restart, not metadata or financial data", async () => {
    const f = fixture();
    await f.service.getCurrentPrice(asset);
    const restarted = new MarketDataService(
      f.db as unknown as Database,
      { current: f.current } as unknown as InstrumentProvider,
      f.links as unknown as InstrumentsService,
    );
    await restarted.getCurrentPrice(asset);
    expect(f.current).toHaveBeenCalledTimes(2);
  });
  it("bounds the cache and refetches evicted public quotes", async () => {
    const { service, current } = fixture();
    for (let index = 0; index < 501; index++)
      await service.getCurrentPrice({
        ...asset,
        instrumentId: `instrument-${index}`,
      });
    expect(current).toHaveBeenCalledTimes(501);
    await service.getCurrentPrice({ ...asset, instrumentId: "instrument-0" });
    expect(current).toHaveBeenCalledTimes(502);
  });
  it("does not fetch while disabled, for unmapped assets, or for a mismatched currency", async () => {
    const { service, current, db } = fixture();
    vi.stubEnv("MARKET_DATA_ENABLED", "false");
    expect((await service.getCurrentPrice(asset)).error).toBe(
      "MARKET_NOT_CONFIGURED",
    );
    vi.stubEnv("MARKET_DATA_ENABLED", "true");
    expect(
      (await service.getCurrentPrice({ ...asset, instrumentId: null })).error,
    ).toBe("MARKET_UNMAPPED");
    expect(
      (await service.getCurrentPrice({ ...asset, currency: "USD" })).error,
    ).toBe("MARKET_IDENTITY_MISMATCH");
    expect(current).not.toHaveBeenCalled();
    expect(db.instrumentMapping.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          instrumentId_provider: {
            instrumentId: "i",
            provider: "Yahoo Finance",
          },
        },
      }),
    );
  });
});
