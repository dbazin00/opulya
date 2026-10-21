import YahooFinance from "yahoo-finance2";
import {
  assetSchema,
  decimal,
  isinSchema,
  timeZoneSchema,
  z,
} from "@opulya/shared";
import type { Database } from "./db.js";
import type {
  Instrument,
  InstrumentMapping,
} from "./generated/prisma/client.js";
import type { InstrumentInput } from "./instruments.js";
import { MarketCache } from "./market-cache.js";

export const YAHOO_PROVIDER = "Yahoo Finance";
export const marketDataEnabled = () =>
  process.env.MARKET_DATA_ENABLED !== "false";
export const directoryTypes = ["STOCK", "ETF", "CRYPTO", "FUND"] as const;
export type DirectoryType = (typeof directoryTypes)[number];
export type ProviderPrice = {
  price: string;
  currency: string;
  provider: string;
  kind: "QUOTE";
  marketAt: Date | null;
  fetchedAt: Date;
  delayMinutes?: number | null;
  marketState?: string | null;
};
const rowSchema = assetSchema.safeExtend({
  assetType: z.enum(directoryTypes),
  mic: z.string().regex(/^(?:[A-Z0-9]{4})?$/),
  timeZone: timeZoneSchema,
  isin: isinSchema.nullable(),
  exchangeName: z.string().trim().min(1).max(100).nullable().optional(),
});
const rowsSchema = z.array(rowSchema).max(50);
const quoteSchema = z.object({
  symbol: z.string().min(1).max(30),
  quoteType: z.string(),
  currency: z.string(),
  exchange: z.string().min(1).max(100),
  fullExchangeName: z.string().trim().min(1).max(100).optional(),
  isin: isinSchema.optional().catch(undefined),
  exchangeTimezoneName: timeZoneSchema,
  shortName: z.string().optional(),
  longName: z.string().optional(),
  regularMarketPrice: z.number().finite().positive().optional(),
  regularMarketTime: z.coerce.date().optional(),
  priceHint: z.number().int().min(0).max(20).optional(),
  exchangeDataDelayedBy: z.number().int().nonnegative().max(1440).optional(),
  marketState: z.string().max(30).optional(),
  retrievedAt: z.coerce.date().optional(),
});
type Quote = z.infer<typeof quoteSchema>;
const types: Record<string, DirectoryType> = {
  EQUITY: "STOCK",
  ETF: "ETF",
  MUTUALFUND: "FUND",
  CRYPTOCURRENCY: "CRYPTO",
};
// Exchange identifiers, not a list of assets. Never infer a listing from its name alone.
const mics: Record<string, string> = {
  AMS: "XAMS",
  PAR: "XPAR",
  BRU: "XBRU",
  LIS: "XLIS",
  GER: "XETR",
  FRA: "XFRA",
  LSE: "XLON",
  MIL: "XMIL",
  EBS: "XSWX",
  SWX: "XSWX",
  HAN: "XHAN",
  HAM: "XHAM",
  NMS: "XNAS",
  NGM: "XNAS",
  NCM: "XNAS",
  NYQ: "XNYS",
  ASE: "XASE",
  PCX: "ARCX",
  TOR: "XTSE",
  ASX: "XASX",
  JPX: "XTKS",
  HKG: "XHKG",
};
export function cryptoBase(symbol: string, currency: string) {
  return symbol.toUpperCase().replace(new RegExp(`[-/]${currency}$`, "i"), "");
}
export function yahooSymbol(
  input: Pick<InstrumentInput, "symbol" | "assetType" | "currency">,
) {
  return input.assetType === "CRYPTO"
    ? `${cryptoBase(input.symbol, input.currency)}-${input.currency}`
    : input.symbol;
}
const currencyUnit = (value: string) =>
  value === "GBp" || value === "GBX"
    ? { currency: "GBP", divisor: "100" }
    : { currency: value, divisor: "1" };

export function yahooInstrument(value: unknown): InstrumentInput | null {
  const parsed = quoteSchema.safeParse(value);
  if (!parsed.success) return null;
  const q = parsed.data,
    assetType = types[q.quoteType];
  if (!assetType) return null;
  const currency = currencyUnit(q.currency).currency;
  if (assetType === "CRYPTO" && !q.symbol.endsWith(`-${currency}`)) return null;
  const row = rowSchema.safeParse({
    symbol:
      assetType === "CRYPTO"
        ? q.symbol.replace(/-([A-Z]{3})$/, "/$1")
        : q.symbol,
    name:
      assetType === "CRYPTO"
        ? (q.longName || q.shortName || q.symbol).replace(
            new RegExp(` ${currency}$`),
            "",
          )
        : q.longName || q.shortName || q.symbol,
    assetType,
    currency,
    exchange: assetType === "CRYPTO" ? "" : q.exchange,
    exchangeName: assetType === "CRYPTO" ? null : (q.fullExchangeName ?? null),
    mic: assetType === "CRYPTO" ? "" : (mics[q.exchange] ?? ""),
    timeZone: q.exchangeTimezoneName,
    isin: q.isin ?? null,
  });
  return row.success ? row.data : null;
}
export function yahooError(error: unknown): string {
  if (error instanceof Error && /^MARKET_[A-Z_]+$/.test(error.message))
    return error.message;
  const detail = z
    .object({
      status: z.number().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .safeParse(error);
  const text = detail.success
    ? `${detail.data.code ?? ""} ${detail.data.message ?? ""}`
    : "";
  const status = detail.success ? detail.data.status : undefined;
  if (status === 429 || /too many requests|rate.?limit|429/i.test(text))
    return "MARKET_RATE_LIMIT";
  if (
    status === 401 ||
    status === 403 ||
    /unauthori[sz]ed|forbidden|consent|invalid crumb/i.test(text)
  )
    return "MARKET_AUTH_FAILED";
  if (status === 404 || /not found|no data found|delisted/i.test(text))
    return "MARKET_SYMBOL_NOT_FOUND";
  return "MARKET_UNAVAILABLE";
}

export class YahooFinanceProvider {
  private readonly cache: MarketCache;
  private readonly quoteCache = new MarketCache();
  private readonly quoteQueue = new Map<
    string,
    { resolve(value: Quote): void; reject(error: unknown): void }[]
  >();
  private quoteTimer?: ReturnType<typeof setTimeout>;
  private readonly client: InstanceType<typeof YahooFinance>;
  private blockedUntil = 0;
  constructor(
    private readonly budget: {
      reserve(): Promise<void>;
      block?(): Promise<void>;
    },
    db?: Database,
    client?: InstanceType<typeof YahooFinance>,
  ) {
    this.cache = new MarketCache(db);
    this.client =
      client ??
      new YahooFinance({
        queue: { concurrency: 1, interval: 300 },
        versionCheck: false,
        suppressNotices: ["yahooSurvey"],
        validation: { logErrors: false },
        fetch: async (url, init) => {
          const response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(15000),
          });
          if (!response.body) return response;
          const reader = response.body.getReader(),
            chunks: Uint8Array[] = [];
          let bytes = 0;
          try {
            for (;;) {
              const next = await reader.read();
              if (next.done) break;
              bytes += next.value.byteLength;
              if (bytes > 2 * 1024 * 1024) {
                await reader.cancel();
                throw new Error("MARKET_UNAVAILABLE");
              }
              chunks.push(next.value);
            }
          } finally {
            reader.releaseLock();
          }
          return new Response(Buffer.concat(chunks), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
        logger: { info() {}, warn() {}, error() {}, debug() {}, dir() {} },
      });
  }
  private async request<T>(load: () => Promise<T>): Promise<T> {
    if (!marketDataEnabled()) throw new Error("MARKET_NOT_CONFIGURED");
    if (this.blockedUntil > Date.now()) throw new Error("MARKET_RATE_LIMIT");
    await this.budget.reserve();
    try {
      return await load();
    } catch (error) {
      const code = yahooError(error);
      if (code === "MARKET_RATE_LIMIT") {
        this.blockedUntil = Date.now() + 60000;
        await this.budget.block?.();
      }
      throw new Error(code, { cause: error });
    }
  }
  private async quotes(symbols: string[]): Promise<Quote[]> {
    return this.request(async () => {
      const rows = await this.client.quote(symbols);
      return rows.flatMap((value) => {
        const parsed = quoteSchema.safeParse(value);
        return parsed.success
          ? [{ ...parsed.data, retrievedAt: new Date() }]
          : [];
      });
    });
  }
  private quote(symbol: string) {
    return this.quoteCache.get(
      `quote:${symbol}`,
      55000,
      quoteSchema,
      () =>
        new Promise<Quote>((resolve, reject) => {
          if (this.quoteQueue.size >= 500) {
            reject(new Error("MARKET_RATE_LIMIT"));
            return;
          }
          this.quoteQueue.set(symbol, [
            ...(this.quoteQueue.get(symbol) ?? []),
            { resolve, reject },
          ]);
          this.quoteTimer ??= setTimeout(() => void this.flushQuotes(), 5);
        }),
    );
  }
  private async flushQuotes() {
    this.quoteTimer = undefined;
    const entries = [...this.quoteQueue.entries()];
    this.quoteQueue.clear();
    for (let i = 0; i < entries.length; i += 30) {
      const batch = entries.slice(i, i + 30);
      try {
        const quotes = await this.quotes(batch.map(([symbol]) => symbol));
        for (const [symbol, callbacks] of batch) {
          const quote = quotes.find((row) => row.symbol === symbol);
          for (const callback of callbacks) {
            if (quote) callback.resolve(quote);
            else callback.reject(new Error("MARKET_SYMBOL_NOT_FOUND"));
          }
        }
      } catch (error) {
        for (const [, callbacks] of batch)
          for (const callback of callbacks) callback.reject(error);
      }
    }
  }
  async search(
    search: string,
    assetType?: InstrumentInput["assetType"],
    currency = "EUR",
  ): Promise<InstrumentInput[]> {
    const query = search.trim();
    if (query.length < 2) return [];
    return this.cache.get(
      JSON.stringify(["search", query.toUpperCase(), assetType, currency]),
      86400000,
      rowsSchema,
      async () => {
        const result = await this.request(() =>
          this.client.search(query, {
            quotesCount: 30,
            newsCount: 0,
            enableFuzzyQuery: false,
          }),
        );
        const symbols = new Set<string>();
        for (const q of result.quotes) {
          const row = z
            .object({ symbol: z.string().max(30), quoteType: z.string() })
            .safeParse(q);
          if (
            !row.success ||
            !types[row.data.quoteType] ||
            (assetType && types[row.data.quoteType] !== assetType)
          )
            continue;
          symbols.add(
            row.data.quoteType === "CRYPTOCURRENCY"
              ? row.data.symbol.replace(/-[A-Z]{3}$/, `-${currency}`)
              : row.data.symbol,
          );
        }
        if (!symbols.size) return [];
        const quotes = await this.quotes([...symbols].slice(0, 30));
        for (const quote of quotes)
          await this.quoteCache.get(
            `quote:${quote.symbol}`,
            55000,
            quoteSchema,
            async () => quote,
          );
        return quotes.flatMap((quote) => {
          const row = yahooInstrument(quote);
          return row &&
            row.currency === currency &&
            (!assetType || row.assetType === assetType)
            ? [row]
            : [];
        });
      },
    );
  }
  async resolve(
    symbol: string,
    currency: string,
    assetType: string,
  ): Promise<InstrumentInput> {
    const rows = await this.cache.get(
      JSON.stringify(["resolve", symbol, currency, assetType]),
      86400000,
      rowsSchema,
      async () =>
        [await this.quote(symbol)].flatMap((quote) => {
          const row = yahooInstrument(quote);
          return row ? [row] : [];
        }),
    );
    const match = rows.find(
      (row) =>
        yahooSymbol(row) === symbol &&
        row.currency === currency &&
        row.assetType === assetType,
    );
    if (!match) throw new Error("MARKET_IDENTITY_MISMATCH");
    return match;
  }
  async matchLegacy(source: InstrumentInput): Promise<InstrumentInput | null> {
    if (source.assetType === "CRYPTO")
      return this.resolve(
        yahooSymbol(source),
        source.currency,
        source.assetType,
      );
    const rows = await this.search(
      source.symbol.replace(/\.[A-Z]+$/, ""),
      source.assetType,
      source.currency,
    );
    const suffix = source.symbol.split(".").at(-1) ?? "";
    const legacyMic =
      source.mic ||
      ({ AMS: "XAMS", DEX: "XETR", LON: "XLON" } as Record<string, string>)[
        suffix
      ];
    const mic =
      legacyMic && ["XNGS", "XNMS", "XNCM"].includes(legacyMic)
        ? "XNAS"
        : legacyMic;
    const matches = rows.filter(
      (row) =>
        row.currency === source.currency &&
        row.assetType === source.assetType &&
        (mic
          ? row.mic === mic
          : row.exchange.toUpperCase() === source.exchange.toUpperCase() ||
            (source.exchange === "United States" &&
              source.currency === "USD" &&
              row.symbol === source.symbol &&
              ["XNAS", "XNYS", "XASE", "ARCX"].includes(row.mic))) &&
        row.symbol.split(".")[0] === source.symbol.split(".")[0],
    );
    return matches.length === 1 ? matches[0]! : null;
  }
  private verifyMapping(mapping: InstrumentMapping, instrument: Instrument) {
    if (
      mapping.provider !== YAHOO_PROVIDER ||
      mapping.symbol !== yahooSymbol(instrument) ||
      mapping.currency !== instrument.currency ||
      mapping.exchange !== instrument.exchange ||
      mapping.mic !== instrument.mic
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
  }
  private verify(
    mapping: InstrumentMapping,
    instrument: Instrument,
    value: unknown,
  ) {
    this.verifyMapping(mapping, instrument);
    const row = yahooInstrument(value);
    if (
      !row ||
      row.symbol !== instrument.symbol ||
      row.currency !== instrument.currency ||
      row.assetType !== instrument.assetType ||
      row.exchange !== instrument.exchange ||
      row.mic !== instrument.mic
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
    return row;
  }
  async current(
    mapping: InstrumentMapping,
    instrument: Instrument,
  ): Promise<ProviderPrice> {
    this.verifyMapping(mapping, instrument);
    const quote = await this.quote(mapping.symbol);
    this.verify(mapping, instrument, quote);
    if (
      !quote?.regularMarketPrice ||
      !quote.regularMarketTime ||
      quote.regularMarketTime > new Date()
    )
      throw new Error("MARKET_UNAVAILABLE");
    return {
      ...this.price(
        quote.regularMarketPrice,
        quote.currency,
        quote.regularMarketTime,
        instrument,
        quote.priceHint,
      ),
      fetchedAt: quote.retrievedAt ?? new Date(),
      delayMinutes: quote.exchangeDataDelayedBy ?? null,
      marketState: quote.marketState ?? null,
    };
  }
  private price(
    value: number,
    unit: string,
    marketAt: Date,
    instrument: Instrument,
    precision = 8,
  ): ProviderPrice {
    const { currency, divisor } = currencyUnit(unit);
    const price = decimal(String(value))
      .div(divisor)
      .toDecimalPlaces(Math.min(8, precision + (divisor === "100" ? 2 : 0)));
    if (
      !price.isFinite() ||
      !price.gt(0) ||
      price.gte("10000000000000000") ||
      currency !== instrument.currency
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
    return {
      price: price.toFixed(),
      currency,
      provider: YAHOO_PROVIDER,
      kind: "QUOTE",
      marketAt,
      fetchedAt: new Date(),
    };
  }
}
