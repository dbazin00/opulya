import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { InstrumentsService, type InstrumentProvider } from "./instruments.js";
import type { Database } from "./db.js";

describe("owned asset choices", () => {
  it("adding another listing cannot silently remap an existing asset", async () => {
    const upsert = vi.fn();
    const service = new InstrumentsService(
      {
        instrument: {
          findFirst: vi.fn(async () => ({
            id: "new",
            symbol: "EXM",
            assetType: "STOCK",
            exchange: "NASDAQ",
            currency: "USD",
          })),
        },
        asset: {
          findFirst: vi.fn(async () => null),
          findUnique: vi.fn(async () => ({
            instrumentId: "original",
            assetType: "STOCK",
          })),
          upsert,
        },
      } as unknown as Database,
      {} as InstrumentProvider,
    );
    await expect(service.select("user-a", "new")).rejects.toThrow(
      "MARKET_IDENTITY_MISMATCH",
    );
    expect(upsert).not.toHaveBeenCalled();
  });
  it("uses owned mappings, not private labels, and collapses crypto sources without mixing currencies or stock venues", async () => {
    const stock = {
      symbol: "EXM",
      assetType: "STOCK" as const,
      currency: "EUR",
      exchange: "XETRA",
    };
    const coin = {
      symbol: "BTC/EUR",
      assetType: "CRYPTO" as const,
      currency: "EUR",
      exchange: "Binance",
    };
    const findMany = vi.fn(async () => [
      { ...stock, symbol: "OLD", instrument: stock },
      {
        ...coin,
        symbol: "BTC",
        exchange: "Kraken",
        marketDataIdentifier: null,
        instrument: null,
      },
    ]);
    const service = new InstrumentsService(
      { asset: { findMany } } as unknown as Database,
      {} as InstrumentProvider,
    );
    const alternative = { ...stock, exchange: "LSE" },
      usd = { ...coin, symbol: "BTC/USD", currency: "USD" };
    expect(
      await service.available("user-a", [stock, coin, alternative, usd]),
    ).toEqual({ items: [alternative, usd], ownedCount: 2 });
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-a" } }),
    );
  });
});

describe("shared price reuse", () => {
  const snapshot = {
    kind: "QUOTE",
    currency: "EUR",
    provider: "Alpha Vantage",
    price: { gt: () => true },
    availableAt: new Date(Date.now() - 1000),
    fetchedAt: new Date(Date.now() - 5 * 60000),
  };
  function fixture(price: unknown = snapshot) {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const db = {
      asset: {
        findFirst: vi.fn(async () => ({
          instrumentId: "instrument",
          currency: "EUR",
        })),
      },
      latestPrice: { findUnique: vi.fn(async () => price) },
      instrumentMapping: {
        findUnique: vi.fn(async (): Promise<unknown> => null),
        updateMany,
      },
    };
    return {
      db,
      updateMany,
      service: new InstrumentsService(
        db as unknown as Database,
        {} as InstrumentProvider,
      ),
    };
  }
  it.each(["QUOTE", "CLOSE"])(
    "automatic adds reuse an existing %s regardless of fetch age",
    async (kind) => {
      const f = fixture({ ...snapshot, kind });
      expect(await f.service.requestCurrent("user-a", "asset")).toEqual({
        ok: true,
        cached: true,
      });
      expect(f.updateMany).not.toHaveBeenCalled();
      expect(f.db.asset.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "asset", userId: "user-a" } }),
      );
    },
  );
  it("repeat adds cannot bypass hourly failure backoff", async () => {
    const f = fixture(null);
    f.db.instrumentMapping.findUnique.mockResolvedValue({
      error: "MARKET_UNAVAILABLE",
      lastAttemptAt: new Date(Date.now() - 20 * 60000),
    });
    await f.service.requestCurrent("user-a", "asset");
    expect(f.updateMany).not.toHaveBeenCalled();
    f.db.instrumentMapping.findUnique.mockResolvedValue({
      error: "MARKET_UNAVAILABLE",
      lastAttemptAt: new Date(Date.now() - 3600001),
    });
    await f.service.requestCurrent("user-a", "asset");
    expect(f.updateMany).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    { ...snapshot, currency: "USD" },
    { ...snapshot, availableAt: new Date(Date.now() + 100000) },
    { ...snapshot, price: { gt: () => false } },
  ])(
    "queues missing/invalid prices with an atomic missing-price condition",
    async (price) => {
      const f = fixture(price);
      expect((await f.service.requestCurrent("user-a", "asset")).cached).toBe(
        false,
      );
      expect(f.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            instrument: expect.objectContaining({
              OR: expect.arrayContaining([{ latestPrice: { is: null } }]),
            }),
          }),
        }),
      );
    },
  );
});
