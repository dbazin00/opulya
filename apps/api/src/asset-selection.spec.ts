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
