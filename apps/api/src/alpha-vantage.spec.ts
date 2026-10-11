import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AlphaVantageProvider,
  ALPHA_PROVIDER,
  alphaError,
  alphaSearchRows,
} from "./alpha-vantage.js";
import type { Database } from "./db.js";
import type {
  Instrument,
  InstrumentMapping,
} from "./generated/prisma/client.js";

const instrument: Instrument = {
  id: "i",
  identity: "identity",
  name: "World ETF",
  symbol: "IWDA.AMS",
  assetType: "ETF",
  exchange: "Amsterdam",
  mic: "",
  currency: "EUR",
  timeZone: "Europe/Amsterdam",
  isin: null,
  createdAt: new Date(),
};
const mapping: InstrumentMapping = {
  id: "m",
  instrumentId: "i",
  provider: ALPHA_PROVIDER,
  symbol: instrument.symbol,
  exchange: instrument.exchange,
  mic: "",
  currency: "EUR",
  lastAttemptAt: null,
  lastSuccessAt: null,
  currentRequestedAt: null,
  error: null,
};
const daily = {
  "Meta Data": { "2. Symbol": "IWDA.AMS", "5. Time Zone": "US/Eastern" },
  "Time Series (Daily)": {
    "2026-10-09": { "4. close": "123.45670000" },
    "2026-10-12": { "4. close": "999" },
  },
};
const crypto = {
  "Realtime Currency Exchange Rate": {
    "1. From_Currency Code": "BTC",
    "3. To_Currency Code": "EUR",
    "5. Exchange Rate": "75000.12340000",
    "6. Last Refreshed": "2026-10-11 11:00:00",
    "7. Time Zone": "UTC",
  },
};
const cryptoInstrument = {
  ...instrument,
  symbol: "BTC/EUR",
  assetType: "CRYPTO" as const,
  exchange: ALPHA_PROVIDER,
  timeZone: "UTC",
};
const cryptoMapping = {
  ...mapping,
  symbol: "BTC/EUR",
  exchange: ALPHA_PROVIDER,
};
const matches = {
  bestMatches: [
    {
      "1. symbol": "IWDA.AMS",
      "2. name": "World ETF",
      "3. type": "ETF",
      "4. region": "Amsterdam",
      "8. currency": "EUR",
    },
    {
      "1. symbol": "IWDA.LON",
      "2. name": "World ETF",
      "3. type": "ETF",
      "4. region": "United Kingdom",
      "8. currency": "USD",
    },
  ],
};
function setup(body: unknown, status = 200, db?: Database) {
  vi.stubEnv("ALPHA_VANTAGE_API_KEY", "fixture-private-key");
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  const fetcher = vi.fn(
    async (_input?: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const budget = { reserve: vi.fn(async () => {}) };
  return { provider: new AlphaVantageProvider(budget, db), fetcher, budget };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Alpha Vantage price adapter", () => {
  it.each(["STOCK", "ETF", "FUND"] as const)(
    "uses a precise completed daily close for %s",
    async (assetType) => {
      const { provider, fetcher, budget } = setup(daily);
      const price = await provider.current(mapping, {
        ...instrument,
        assetType,
      });
      expect(price).toMatchObject({
        price: "123.4567",
        currency: "EUR",
        provider: ALPHA_PROVIDER,
        kind: "CLOSE",
        marketAt: null,
      });
      expect(price.tradingDate.toISOString()).toBe("2026-10-09T00:00:00.000Z");
      expect(price.availableAt.toISOString()).toBe("2026-10-10T04:00:00.000Z");
      const url = new URL(String(fetcher.mock.calls[0]![0]));
      expect(url.origin).toBe("https://www.alphavantage.co");
      expect(url.searchParams.get("function")).toBe("TIME_SERIES_DAILY");
      expect(url.searchParams.get("symbol")).toBe("IWDA.AMS");
      expect(url.searchParams.get("outputsize")).toBe("compact");
      expect(budget.reserve).toHaveBeenCalledOnce();
    },
  );
  it("validates the full regional symbol, not only its base ticker", async () => {
    const { provider } = setup({
      ...daily,
      "Meta Data": { ...daily["Meta Data"], "2. Symbol": "IWDA.LON" },
    });
    await expect(provider.current(mapping, instrument)).rejects.toThrow(
      "MARKET_IDENTITY_MISMATCH",
    );
  });
  it.each(["0", "-1", "NaN", "1e5", "12.123456789"])(
    "rejects invalid or unrepresentable financial price %s",
    async (value) => {
      const { provider } = setup({
        ...daily,
        "Time Series (Daily)": { "2026-10-09": { "4. close": value } },
      });
      await expect(provider.current(mapping, instrument)).rejects.toThrow(
        "MARKET_UNAVAILABLE",
      );
    },
  );
  it("rejects an invalid provider timezone", async () => {
    const { provider } = setup({
      ...daily,
      "Meta Data": { ...daily["Meta Data"], "5. Time Zone": "Invalid/Zone" },
    });
    await expect(provider.current(mapping, instrument)).rejects.toThrow(
      "MARKET_UNAVAILABLE",
    );
  });
  it("does not present an unfinished daily candle as a completed price", async () => {
    const { provider } = setup({
      ...daily,
      "Time Series (Daily)": { "2026-10-11": { "4. close": "123" } },
    });
    await expect(provider.current(mapping, instrument)).rejects.toThrow(
      "MARKET_UNAVAILABLE",
    );
  });
  it("fetches a crypto quote for the exact base and quote currencies", async () => {
    const { provider, fetcher } = setup(crypto);
    const price = await provider.close(cryptoMapping, cryptoInstrument);
    expect(price).toMatchObject({
      price: "75000.1234",
      currency: "EUR",
      kind: "QUOTE",
    });
    expect(price.marketAt!.toISOString()).toBe("2026-10-11T11:00:00.000Z");
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.searchParams.get("function")).toBe("CURRENCY_EXCHANGE_RATE");
    expect(url.searchParams.get("from_currency")).toBe("BTC");
    expect(url.searchParams.get("to_currency")).toBe("EUR");
  });
  it.each([
    { "1. From_Currency Code": "ETH" },
    { "3. To_Currency Code": "USD" },
  ])("rejects a different crypto instrument: %j", async (extra) => {
    const { provider } = setup({
      ...crypto,
      "Realtime Currency Exchange Rate": {
        ...crypto["Realtime Currency Exchange Rate"],
        ...extra,
      },
    });
    await expect(
      provider.current(cryptoMapping, cryptoInstrument),
    ).rejects.toThrow("MARKET_IDENTITY_MISMATCH");
  });
  it("rejects a future crypto timestamp", async () => {
    const { provider } = setup({
      ...crypto,
      "Realtime Currency Exchange Rate": {
        ...crypto["Realtime Currency Exchange Rate"],
        "6. Last Refreshed": "2026-10-12 11:00:00",
      },
    });
    await expect(
      provider.current(cryptoMapping, cryptoInstrument),
    ).rejects.toThrow("MARKET_UNAVAILABLE");
  });
  it("does not fetch using a retired provider mapping", async () => {
    const { provider, fetcher, budget } = setup(daily);
    await expect(
      provider.close({ ...mapping, provider: "Twelve Data" }, instrument),
    ).rejects.toThrow("MARKET_UNMAPPED");
    expect(fetcher).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("fails closed without a key and spends no credits", async () => {
    const { provider, fetcher, budget } = setup(daily);
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    await expect(provider.current(mapping, instrument)).rejects.toThrow(
      "MARKET_NOT_CONFIGURED",
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it.each([
    [
      {
        Note: "Please spread requests: 1 request per second. Upgrade to premium to lift 25 requests per day.",
      },
      "MARKET_RATE_LIMIT",
    ],
    [
      { Information: "This is a premium endpoint. fixture-private-key" },
      "MARKET_PLAN_REQUIRED",
    ],
    [
      { "Error Message": "Invalid API call. Please retry." },
      "MARKET_SYMBOL_NOT_FOUND",
    ],
    [
      { Information: "Invalid API key fixture-private-key" },
      "MARKET_AUTH_FAILED",
    ],
  ])(
    "normalizes provider errors without exposing diagnostic text: %j",
    async (body, code) => {
      const { provider } = setup(body);
      await expect(provider.current(mapping, instrument)).rejects.toThrow(
        new RegExp(`^${code}$`),
      );
    },
  );
  it.each([401, 403, 429, 503])(
    "handles HTTP error %i safely",
    async (status) => {
      const { provider } = setup({}, status);
      await expect(provider.current(mapping, instrument)).rejects.toThrow(
        status === 429
          ? "MARKET_RATE_LIMIT"
          : status === 401 || status === 403
            ? "MARKET_AUTH_FAILED"
            : "MARKET_UNAVAILABLE",
      );
    },
  );
  it("ignores malformed diagnostics instead of reflecting them", () => {
    expect(alphaError({ Information: "x".repeat(3000) }, 503)).toBe(
      "MARKET_UNAVAILABLE",
    );
  });
});

describe("Alpha Vantage catalogue and shared cache", () => {
  it("parses regional security identities and skips unsupported currencies/types", () => {
    const rows = alphaSearchRows({
      bestMatches: [
        ...matches.bestMatches,
        { ...matches.bestMatches[0], "3. type": "Currency" },
        { ...matches.bestMatches[0], "8. currency": "GBX" },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      symbol: "IWDA.AMS",
      assetType: "ETF",
      currency: "EUR",
      exchange: "Amsterdam",
      timeZone: "Europe/Amsterdam",
    });
  });
  it("shares one search across currencies, asset types and concurrent calls", async () => {
    const { provider, fetcher, budget } = setup(matches);
    const [eur, usd] = await Promise.all([
      provider.search("IWDA", "ETF", "EUR"),
      provider.search("iwda", "ETF", "USD"),
    ]);
    expect(eur[0]!.symbol).toBe("IWDA.AMS");
    expect(usd[0]!.symbol).toBe("IWDA.LON");
    expect(await provider.search("IWDA", "FUND", "EUR")).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(budget.reserve).toHaveBeenCalledOnce();
  });
  it("uses the official coin CSV, not predefined BTC/ETH or exchange variants", async () => {
    const { provider, fetcher, budget } = setup({});
    fetcher.mockImplementation(
      async () =>
        new Response(
          "currency code,currency name\nBTC,Bitcoin\nETH,Ethereum\nWBTC,Wrapped Bitcoin\nAAVE,Aave\n",
          { headers: { "Content-Type": "text/csv" } },
        ),
    );
    const bitcoin = await provider.search("Bitcoin", undefined, "EUR");
    expect(bitcoin).toHaveLength(1);
    expect(bitcoin[0]).toMatchObject({
      symbol: "BTC/EUR",
      name: "Bitcoin",
      exchange: ALPHA_PROVIDER,
    });
    expect(await provider.references("CRYPTO")).toHaveLength(28);
    expect((await provider.search("AAVE", "CRYPTO", "USD"))[0]!.symbol).toBe(
      "AAVE/USD",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(budget.reserve).not.toHaveBeenCalled();
  });
  it("does not manufacture a full worldwide fund catalogue", async () => {
    const { provider, fetcher } = setup(matches);
    expect(await provider.references("FUND")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reuses one US listing CSV for stocks and ETFs", async () => {
    const { provider, fetcher, budget } = setup({});
    fetcher.mockImplementation(
      async () =>
        new Response(
          "symbol,name,exchange,assetType,ipoDate,delistingDate,status\nIBM,IBM,NYSE,Stock,1990-01-01,,Active\nSPY,SPDR,NYSE ARCA,ETF,1993-01-01,,Active\n",
          { headers: { "Content-Type": "text/csv" } },
        ),
    );
    expect((await provider.references("STOCK"))[0]).toMatchObject({
      symbol: "IBM",
      currency: "USD",
      exchange: "United States",
    });
    expect((await provider.references("ETF"))[0]).toMatchObject({
      symbol: "SPY",
      type: "ETF",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(budget.reserve).toHaveBeenCalledOnce();
  });
  it("matches a legacy Amsterdam listing exactly and does not guess CBOE aliases", async () => {
    const { provider, fetcher } = setup(matches);
    expect(
      await provider.matchLegacy({
        ...instrument,
        symbol: "IWDA",
        exchange: "Euronext",
        mic: "XAMS",
      }),
    ).toMatchObject({ symbol: "IWDA.AMS", currency: "EUR" });
    expect(
      await provider.matchLegacy({
        ...instrument,
        symbol: "IWDAA",
        exchange: "CBOE",
        mic: "BCXE",
      }),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("reuses persisted search metadata after an API restart", async () => {
    const stored = new Map<string, unknown>();
    const db = {
      instrumentDirectoryCache: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            stored.get(where.id) ?? null,
        ),
        upsert: vi.fn(
          async ({
            where,
            create,
          }: {
            where: { id: string };
            create: unknown;
          }) => {
            stored.set(where.id, create);
            return create;
          },
        ),
      },
      marketJob: {
        upsert: vi.fn(async () => ({})),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as Database;
    const { provider, fetcher, budget } = setup(matches, 200, db);
    await provider.search("IWDA", "ETF", "EUR");
    const restarted = new AlphaVantageProvider(budget, db);
    expect((await restarted.search("iwda", "ETF", "EUR"))[0]!.symbol).toBe(
      "IWDA.AMS",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    expect(budget.reserve).toHaveBeenCalledOnce();
  });
});
