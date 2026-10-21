import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import YahooFinance from "yahoo-finance2";
import {
  YahooFinanceProvider,
  YAHOO_PROVIDER,
  yahooInstrument,
  yahooError,
} from "./yahoo-finance.js";
import { MarketCache } from "./market-cache.js";
import { z } from "@opulya/shared";
import type { Database } from "./db.js";
import type {
  Instrument,
  InstrumentMapping,
} from "./generated/prisma/client.js";

const now = new Date("2026-10-19T12:00:00Z");
const etf = {
  symbol: "IWDA.AS",
  quoteType: "ETF",
  currency: "EUR",
  exchange: "AMS",
  fullExchangeName: "Amsterdam",
  exchangeTimezoneName: "Europe/Amsterdam",
  longName: "iShares Core MSCI World UCITS ETF",
  regularMarketPrice: 130.67,
  regularMarketTime: new Date("2026-10-19T11:55:00Z"),
};
const coin = {
  ...etf,
  symbol: "BTC-EUR",
  quoteType: "CRYPTOCURRENCY",
  exchange: "CCC",
  exchangeTimezoneName: "UTC",
  longName: "Bitcoin EUR",
  regularMarketPrice: 73075.52,
};
function setup(quote: typeof etf & { priceHint?: number } = etf) {
  const client = {
    search: vi.fn().mockResolvedValue({
      quotes: [{ symbol: quote.symbol, quoteType: quote.quoteType }],
    }),
    quote: vi.fn().mockResolvedValue([quote]),
  };
  const budget = { reserve: vi.fn().mockResolvedValue(undefined) };
  const provider = new YahooFinanceProvider(
    budget,
    undefined,
    client as unknown as InstanceType<typeof YahooFinance>,
  );
  const instrument = {
    ...yahooInstrument(quote)!,
    id: "i",
    identity: "i",
    createdAt: now,
  } as Instrument;
  const mapping = {
    id: "m",
    instrumentId: "i",
    provider: YAHOO_PROVIDER,
    symbol: quote.symbol,
    exchange: instrument.exchange,
    mic: instrument.mic,
    currency: instrument.currency,
  } as InstrumentMapping;
  return { client, budget, provider, instrument, mapping };
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

describe("Yahoo catalogue and identity", () => {
  it("never downloads a catalogue or provides predefined assets on empty input", async () => {
    const { provider, client, budget } = setup();
    expect(await provider.search("")).toEqual([]);
    expect(await provider.search("a")).toEqual([]);
    expect(client.search).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("normalizes European ETF, stock, fund and crypto metadata", () => {
    expect(yahooInstrument(etf)).toMatchObject({
      symbol: "IWDA.AS",
      currency: "EUR",
      mic: "XAMS",
      assetType: "ETF",
      exchangeName: "Amsterdam",
    });
    expect(yahooInstrument({ ...etf, quoteType: "EQUITY" })?.assetType).toBe(
      "STOCK",
    );
    expect(
      yahooInstrument({ ...etf, quoteType: "MUTUALFUND" })?.assetType,
    ).toBe("FUND");
    expect(yahooInstrument(coin)).toMatchObject({
      name: "Bitcoin",
      symbol: "BTC/EUR",
      exchange: "",
      assetType: "CRYPTO",
    });
  });
  it("keeps readable venue metadata separate from listing identity and never invents ISINs", async () => {
    const { provider, client } = setup();
    client.search.mockResolvedValue({
      quotes: [
        { symbol: "IWDA.AS", quoteType: "ETF" },
        { symbol: "IWDAA.XC", quoteType: "ETF" },
      ],
    });
    client.quote.mockResolvedValue([
      etf,
      {
        ...etf,
        symbol: "IWDAA.XC",
        exchange: "CXE",
        fullExchangeName: "Cboe Europe",
      },
    ]);
    const rows = await provider.search("IWDA", "ETF", "EUR");
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.symbol)).toEqual(["IWDA.AS", "IWDAA.XC"]);
    expect(rows[1]).toMatchObject({
      exchange: "CXE",
      exchangeName: "Cboe Europe",
      isin: null,
    });
    expect(
      yahooInstrument({ ...etf, fullExchangeName: undefined })?.exchangeName,
    ).toBeNull();
    expect(yahooInstrument(coin)?.exchangeName).toBeNull();
    expect(yahooInstrument({ ...etf, isin: "IE00B4L5Y983" })?.isin).toBe(
      "IE00B4L5Y983",
    );
    expect(yahooInstrument({ ...etf, isin: "IE00B4L5Y984" })?.isin).toBeNull();
  });
  it("rejects unsupported currencies, classes, timezones and ambiguous crypto pairs", () => {
    for (const change of [
      { currency: "XYZ" },
      { quoteType: "OPTION" },
      { exchangeTimezoneName: "fake" },
      { symbol: "bad symbol" },
    ])
      expect(yahooInstrument({ ...etf, ...change })).toBeNull();
    expect(yahooInstrument({ ...coin, symbol: "BTC-USD" })).toBeNull();
  });
  it("searches on demand, filters verified currencies and reuses metadata and initial quote", async () => {
    const { provider, client, instrument, mapping } = setup();
    const [first, second] = await Promise.all([
      provider.search("IWDA", "ETF", "EUR"),
      provider.search("IWDA", "ETF", "EUR"),
    ]);
    expect(first).toEqual(second);
    expect(first).toHaveLength(1);
    expect(client.search).toHaveBeenCalledOnce();
    expect(client.quote).toHaveBeenCalledOnce();
    await provider.resolve("IWDA.AS", "EUR", "ETF");
    await provider.current(mapping, instrument);
    expect(client.quote).toHaveBeenCalledOnce();
    expect(await provider.search("IWDA", "ETF", "USD")).toEqual([]);
  });
  it("finds the requested crypto currency without defining a list of coins or brokers", async () => {
    const { provider, client } = setup(coin);
    client.search.mockResolvedValue({
      quotes: [{ symbol: "BTC-USD", quoteType: "CRYPTOCURRENCY" }],
    });
    const rows = await provider.search("bitcoin", "CRYPTO", "EUR");
    expect(client.quote).toHaveBeenCalledWith(["BTC-EUR"]);
    expect(rows[0]?.symbol).toBe("BTC/EUR");
  });
  it("revalidates selection against symbol, currency and type", async () => {
    const { provider } = setup();
    await expect(provider.resolve("IWDA.AS", "USD", "ETF")).rejects.toThrow(
      "MARKET_IDENTITY_MISMATCH",
    );
    await expect(provider.resolve("IWDA.AS", "EUR", "STOCK")).rejects.toThrow(
      "MARKET_IDENTITY_MISMATCH",
    );
  });
  it("does not silently map a legacy listing to another exchange or currency", async () => {
    const { provider, instrument } = setup();
    expect(
      await provider.matchLegacy({ ...instrument, symbol: "IWDA.AMS" }),
    ).toMatchObject({ symbol: "IWDA.AS" });
    expect(
      await provider.matchLegacy({ ...instrument, mic: "XLON" }),
    ).toBeNull();
    expect(
      await provider.matchLegacy({ ...instrument, currency: "USD" }),
    ).toBeNull();
  });
  it("resolves qualified legacy European symbols without guessing from a fund name", async () => {
    const { provider, instrument } = setup();
    expect(
      await provider.matchLegacy({
        ...instrument,
        symbol: "IWDA.AMS",
        mic: "",
        exchange: "Amsterdam",
      }),
    ).toMatchObject({ symbol: "IWDA.AS", mic: "XAMS" });
    expect(
      await provider.matchLegacy({
        ...instrument,
        symbol: "IWDA",
        mic: "",
        exchange: "Euronext",
      }),
    ).toBeNull();
  });
  it("maps an exact US ticker in USD, but not an international namesake", async () => {
    const { provider, instrument } = setup({
      ...etf,
      symbol: "AAPL",
      quoteType: "EQUITY",
      exchange: "NMS",
      currency: "USD",
    });
    expect(
      await provider.matchLegacy({
        ...instrument,
        mic: "",
        exchange: "United States",
      }),
    ).toMatchObject({ symbol: "AAPL", mic: "XNAS" });
    expect(
      await provider.matchLegacy({
        ...instrument,
        symbol: "AAPL",
        mic: "",
        exchange: "Germany",
      }),
    ).toBeNull();
  });
});
describe("Yahoo prices", () => {
  it.each(["Alpha Vantage", "Twelve Data", "Coinbase"])(
    "rejects a %s mapping before looking up any quote",
    async (source) => {
      const { provider, client, mapping, instrument } = setup();
      const foreign = { ...mapping, provider: source };
      await expect(provider.current(foreign, instrument)).rejects.toThrow(
        "MARKET_IDENTITY_MISMATCH",
      );
      expect(client.quote).not.toHaveBeenCalled();
    },
  );
  it.each([etf, coin, { ...etf, quoteType: "MUTUALFUND" }])(
    "uses precise normalized quotes for $quoteType",
    async (q) => {
      const { provider, mapping, instrument } = setup(q);
      expect(await provider.current(mapping, instrument)).toMatchObject({
        price: String(q.regularMarketPrice),
        currency: "EUR",
        kind: "QUOTE",
        provider: YAHOO_PROVIDER,
      });
    },
  );
  it("converts London pence to pounds without changing quantity or cost basis", async () => {
    const { provider, mapping, instrument } = setup({
      ...etf,
      symbol: "ETF.L",
      exchange: "LSE",
      currency: "GBp",
      regularMarketPrice: 12345,
    });
    expect(instrument.currency).toBe("GBP");
    expect(await provider.current(mapping, instrument)).toMatchObject({
      price: "123.45",
      currency: "GBP",
    });
  });
  it("preserves fractional pence at the provider's reported precision", async () => {
    const { provider, mapping, instrument } = setup({
      ...etf,
      symbol: "ETF.L",
      exchange: "LSE",
      currency: "GBp",
      regularMarketPrice: 12345.67,
      priceHint: 2,
    });
    expect((await provider.current(mapping, instrument)).price).toBe(
      "123.4567",
    );
  });
  it("rejects symbol, exchange, type, currency and future-price mismatches", async () => {
    for (const change of [
      { currency: "USD" },
      { exchange: "LSE" },
      { symbol: "OTHER.AS" },
      { quoteType: "EQUITY" },
      { regularMarketTime: new Date("2027-01-01") },
    ]) {
      const { provider, client, mapping, instrument } = setup();
      client.quote.mockResolvedValue([{ ...etf, ...change }]);
      await expect(provider.current(mapping, instrument)).rejects.toThrow(
        /MARKET_/,
      );
    }
  });
  it("backs off on throttling, sanitizes errors and does not retry blocked requests", async () => {
    const { provider, client } = setup();
    client.search.mockRejectedValue(new Error("Too Many Requests"));
    await expect(provider.search("IWDA")).rejects.toThrow("MARKET_RATE_LIMIT");
    await expect(provider.search("AAPL")).rejects.toThrow("MARKET_RATE_LIMIT");
    expect(client.search).toHaveBeenCalledOnce();
    expect(yahooError(new Error("private server details"))).toBe(
      "MARKET_UNAVAILABLE",
    );
    expect(yahooError({ status: 403 })).toBe("MARKET_AUTH_FAILED");
  });
  it("does not make requests when disabled", async () => {
    const { provider, client } = setup();
    vi.stubEnv("MARKET_DATA_ENABLED", "false");
    await expect(provider.search("IWDA")).rejects.toThrow(
      "MARKET_NOT_CONFIGURED",
    );
    expect(client.search).not.toHaveBeenCalled();
  });
});
describe("bounded public metadata cache", () => {
  it("batches simultaneous current quotes, reuses them in memory, and never writes prices to PostgreSQL", async () => {
    const quote = vi.fn().mockResolvedValue([etf, coin]);
    const db = {
      instrumentDirectoryCache: { findUnique: vi.fn(), upsert: vi.fn() },
      marketJob: { upsert: vi.fn() },
    };
    const budget = { reserve: vi.fn().mockResolvedValue(undefined) };
    const provider = new YahooFinanceProvider(
      budget,
      db as unknown as Database,
      { quote } as unknown as InstanceType<typeof YahooFinance>,
    );
    const first = setup().instrument,
      second = { ...first, ...yahooInstrument(coin)!, id: "coin" };
    const mapping = (instrument: Instrument): InstrumentMapping => ({
      id: instrument.id,
      instrumentId: instrument.id,
      provider: YAHOO_PROVIDER,
      symbol: instrument.assetType === "CRYPTO" ? "BTC-EUR" : "IWDA.AS",
      exchange: instrument.exchange,
      mic: instrument.mic,
      currency: instrument.currency,
    });
    const values = await Promise.all([
      provider.current(mapping(first), first),
      provider.current(mapping(second), second),
    ]);
    expect(values.map((row) => row.price)).toEqual(["130.67", "73075.52"]);
    expect(quote).toHaveBeenCalledOnce();
    expect(quote).toHaveBeenCalledWith(["IWDA.AS", "BTC-EUR"]);
    expect(budget.reserve).toHaveBeenCalledOnce();
    await provider.current(mapping(first), first);
    expect(quote).toHaveBeenCalledOnce();
    expect(db.instrumentDirectoryCache.findUnique).not.toHaveBeenCalled();
    expect(db.instrumentDirectoryCache.upsert).not.toHaveBeenCalled();
    expect(db.marketJob.upsert).not.toHaveBeenCalled();
  });
  it("deduplicates and expires queries", async () => {
    const cache = new MarketCache(),
      load = vi.fn().mockResolvedValue(["a"]),
      schema = z.array(z.string());
    await Promise.all([
      cache.get("k", 1000, schema, load),
      cache.get("k", 1000, schema, load),
    ]);
    expect(load).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(now.getTime() + 1001));
    await cache.get("k", 1000, schema, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("survives a server restart without a second provider request", async () => {
    let saved: unknown;
    const db = {
      instrumentDirectoryCache: {
        findUnique: vi.fn(async () => saved ?? null),
        upsert: vi.fn(async ({ create }) => {
          saved = create;
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      marketJob: {
        upsert: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const load = vi.fn().mockResolvedValue(["a"]),
      schema = z.array(z.string());
    await new MarketCache(db as unknown as Database).get(
      "k",
      1000,
      schema,
      load,
    );
    expect(
      await new MarketCache(db as unknown as Database).get(
        "k",
        1000,
        schema,
        load,
      ),
    ).toEqual(["a"]);
    expect(load).toHaveBeenCalledOnce();
  });
});
