import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InstrumentProvider,
  InstrumentsService,
  instrumentIdentity,
  catalogueChoices,
  exactCryptoChoices,
} from "./instruments.js";
import type { Database } from "./db.js";
import type { Asset, Instrument } from "./generated/prisma/client.js";

const instrument: Instrument = {
  id: "i",
  name: "Example stock",
  symbol: "EXM",
  assetType: "STOCK",
  exchange: "NASDAQ",
  exchangeName: null,
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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("instrument identities and discovery", () => {
  it("uses Yahoo's platform-independent coin instead of ranking crypto trading platforms", () => {
    const old = {
      ...instrument,
      symbol: "BTC/EUR",
      currency: "EUR",
      assetType: "CRYPTO" as const,
      exchange: "Old platform",
    };
    const canonical = { ...old, exchange: "" };
    const alias = { ...old, symbol: "BTC-EUR", exchange: "Other platform" };
    expect(catalogueChoices([old, canonical, alias])).toEqual([canonical]);
    expect(catalogueChoices([canonical, old, alias])).toEqual([canonical]);
  });
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
});
