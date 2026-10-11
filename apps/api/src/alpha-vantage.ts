import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { parse } from "csv-parse/sync";
import { DateTime } from "luxon";
import {
  assetSchema,
  currencies,
  decimal,
  timeZoneSchema,
  z,
} from "@opulya/shared";
import type { Database } from "./db.js";
import type {
  Instrument,
  InstrumentMapping,
} from "./generated/prisma/client.js";
import type { InstrumentInput } from "./instruments.js";

export const ALPHA_PROVIDER = "Alpha Vantage";
const compress = promisify(gzip),
  decompress = promisify(gunzip);
const maxBytes = 8 * 1024 * 1024;
const priceValue = z
  .string()
  .regex(/^\d{1,16}(?:\.\d{1,20})?$/)
  .refine(
    (value) => decimal(value).gt(0) && decimal(value).decimalPlaces() <= 8,
  );
const rowSchema = assetSchema.safeExtend({
  assetType: z.enum(["STOCK", "ETF", "CRYPTO", "FUND"]),
  mic: z.string().regex(/^(?:[A-Z0-9]{4})?$/),
  timeZone: timeZoneSchema,
  isin: z.string().nullable(),
});
const rowsSchema = z.array(rowSchema).max(30000);
const coinsSchema = z
  .array(
    z.object({
      code: z.string().regex(/^[A-Z0-9]{1,20}$/),
      name: z.string().min(1).max(500),
    }),
  )
  .min(1)
  .max(10000);
const regionZones: Record<string, string> = {
  "United States": "America/New_York",
  Amsterdam: "Europe/Amsterdam",
  Netherlands: "Europe/Amsterdam",
  "United Kingdom": "Europe/London",
  Canada: "America/Toronto",
  Toronto: "America/Toronto",
  Germany: "Europe/Berlin",
  Frankfurt: "Europe/Berlin",
  Paris: "Europe/Paris",
  France: "Europe/Paris",
  Belgium: "Europe/Brussels",
  Brussels: "Europe/Brussels",
  Switzerland: "Europe/Zurich",
  Australia: "Australia/Sydney",
  India: "Asia/Kolkata",
  China: "Asia/Shanghai",
  "Hong Kong": "Asia/Hong_Kong",
};
const types: Record<string, InstrumentInput["assetType"]> = {
  Equity: "STOCK",
  Stock: "STOCK",
  ETF: "ETF",
  "Mutual Fund": "FUND",
  Fund: "FUND",
};
export type ProviderPrice = {
  price: string;
  currency: string;
  provider: string;
  kind: "CLOSE" | "QUOTE";
  marketAt: Date | null;
  tradingDate: Date;
  availableAt: Date;
  fetchedAt: Date;
};
type Budget = { reserve(): Promise<void> };
type FunctionName =
  | "SYMBOL_SEARCH"
  | "LISTING_STATUS"
  | "TIME_SERIES_DAILY"
  | "CURRENCY_EXCHANGE_RATE";

export function alphaSearchRows(body: unknown): InstrumentInput[] {
  const matches = z
    .object({
      bestMatches: z
        .array(
          z.object({
            "1. symbol": z.string(),
            "2. name": z.string(),
            "3. type": z.string(),
            "4. region": z.string().min(1).max(100),
            "8. currency": z.string(),
          }),
        )
        .max(100),
    })
    .parse(body).bestMatches;
  return matches.flatMap((row) => {
    const assetType = types[row["3. type"]];
    if (!assetType) return [];
    const input = rowSchema.safeParse({
      symbol: row["1. symbol"],
      name: row["2. name"],
      assetType,
      exchange: row["4. region"],
      mic: "",
      currency: row["8. currency"],
      timeZone: regionZones[row["4. region"]] ?? "UTC",
      isin: null,
    });
    return input.success ? [input.data] : [];
  });
}

export function alphaError(body: unknown, status: number): string | null {
  const parsed = z
    .object({
      Information: z.string().max(2048).optional(),
      Note: z.string().max(2048).optional(),
      "Error Message": z.string().max(2048).optional(),
    })
    .safeParse(body);
  if (status === 429) return "MARKET_RATE_LIMIT";
  if (status === 401 || status === 403) return "MARKET_AUTH_FAILED";
  if (!parsed.success) return status >= 400 ? "MARKET_UNAVAILABLE" : null;
  const text =
    parsed.data.Note ?? parsed.data.Information ?? parsed.data["Error Message"];
  if (text) {
    if (
      /rate limit|call frequency|requests? per (?:day|minute|second)|spreading out/i.test(
        text,
      )
    )
      return "MARKET_RATE_LIMIT";
    if (
      /premium (?:endpoint|function)|premium-only|premium API key|requires? .*premium/i.test(
        text,
      )
    )
      return "MARKET_PLAN_REQUIRED";
    if (
      /invalid.*api.?key|api.?key.*invalid|demo api key|claim your free api key/i.test(
        text,
      )
    )
      return "MARKET_AUTH_FAILED";
    return parsed.data["Error Message"]
      ? "MARKET_SYMBOL_NOT_FOUND"
      : "MARKET_UNAVAILABLE";
  }
  return status === 404
    ? "MARKET_SYMBOL_NOT_FOUND"
    : status >= 400
      ? "MARKET_UNAVAILABLE"
      : null;
}

async function boundedText(response: Response) {
  if (!response.body) throw new Error("MARKET_UNAVAILABLE");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("MARKET_UNAVAILABLE");
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    reader.releaseLock();
  }
}

export class AlphaVantageProvider {
  private readonly memory = new Map<string, { at: number; value: unknown }>();
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(
    private readonly budget: Budget,
    private readonly db?: Database,
  ) {}

  private async cached<T>(
    name: string,
    ttl: number,
    schema: z.ZodType<T>,
    retrieve: () => Promise<T>,
  ): Promise<T> {
    const id = `alpha-vantage:v1:${name}`;
    const read = async (): Promise<T | null> => {
      const local = this.memory.get(id);
      if (local && local.at > Date.now() - ttl)
        return schema.parse(local.value);
      const saved = await this.db?.instrumentDirectoryCache.findUnique({
        where: { id },
      });
      if (
        !saved ||
        saved.version !== 2 ||
        saved.fetchedAt.getTime() <= Date.now() - ttl ||
        saved.fetchedAt.getTime() > Date.now() ||
        saved.payload.byteLength > maxBytes
      )
        return null;
      try {
        const bytes = await decompress(saved.payload, {
          maxOutputLength: maxBytes,
        });
        const value = schema.parse(JSON.parse(bytes.toString("utf8")));
        this.memory.set(id, { at: saved.fetchedAt.getTime(), value });
        return value;
      } catch {
        return null;
      }
    };
    const saved = await read();
    if (saved !== null) return saved;
    const active = this.pending.get(id);
    if (active) return active as Promise<T>;
    const work = (async () => {
      const token = randomUUID();
      let locked = false;
      try {
        if (this.db) {
          await this.db.marketJob.upsert({
            where: { id },
            create: { id, leaseUntil: new Date(0) },
            update: {},
          });
          locked = !!(
            await this.db.marketJob.updateMany({
              where: { id, leaseUntil: { lt: new Date() } },
              data: { token, leaseUntil: new Date(Date.now() + 120000) },
            })
          ).count;
          if (!locked) {
            for (let i = 0; i < 100; i++) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              const published = await read();
              if (published !== null) return published;
            }
            throw new Error("MARKET_UNAVAILABLE");
          }
          const published = await read();
          if (published !== null) return published;
        }
        const value = schema.parse(await retrieve()),
          fetchedAt = new Date();
        const json = JSON.stringify(value);
        if (Buffer.byteLength(json) > maxBytes)
          throw new Error("MARKET_UNAVAILABLE");
        if (this.db) {
          const data = { version: 2, fetchedAt, payload: await compress(json) };
          await this.db.instrumentDirectoryCache.upsert({
            where: { id },
            create: { id, ...data },
            update: data,
          });
        }
        if (this.memory.size >= 200)
          this.memory.delete(this.memory.keys().next().value!);
        this.memory.set(id, { at: fetchedAt.getTime(), value });
        return value;
      } finally {
        if (this.db && locked)
          await this.db.marketJob.updateMany({
            where: { id, token },
            data: { token: null, leaseUntil: new Date(0) },
          });
      }
    })().finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    return work;
  }

  private async request(
    name: FunctionName,
    params: Record<string, string> = {},
    csv = false,
  ) {
    const key = process.env.ALPHA_VANTAGE_API_KEY?.trim();
    if (!key) throw new Error("MARKET_NOT_CONFIGURED");
    await this.budget.reserve();
    const url = new URL("https://www.alphavantage.co/query");
    url.search = new URLSearchParams({
      function: name,
      ...params,
      apikey: key,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) }),
      text = await boundedText(response);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      if (csv && response.ok && !/^\s*</.test(text)) return text;
      throw new Error("MARKET_UNAVAILABLE");
    }
    const error = alphaError(body, response.status);
    if (error) throw new Error(error);
    if (csv) throw new Error("MARKET_UNAVAILABLE");
    return body;
  }

  private coins() {
    return this.cached("coins", 7 * 86400000, coinsSchema, async () => {
      const response = await fetch(
        "https://www.alphavantage.co/digital_currency_list/",
        { signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) throw new Error("MARKET_UNAVAILABLE");
      const rows: Record<string, string>[] = parse(
        await boundedText(response),
        {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          max_record_size: 4096,
        },
      );
      return rows.flatMap((row) => {
        const value = coinsSchema.element.safeParse({
          code: row.currency_code ?? row["currency code"],
          name: row.currency_name ?? row["currency name"],
        });
        return value.success ? [value.data] : [];
      });
    });
  }

  private usListings() {
    return this.cached("us-listings", 86400000, rowsSchema.min(1), async () => {
      const csv = await this.request(
        "LISTING_STATUS",
        { state: "active" },
        true,
      );
      if (typeof csv !== "string") throw new Error("MARKET_UNAVAILABLE");
      const rows: Record<string, string>[] = parse(csv, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        max_record_size: 4096,
      });
      return rows.flatMap((row) => {
        const assetType =
          row.assetType === "Stock"
            ? "STOCK"
            : row.assetType === "ETF"
              ? "ETF"
              : null;
        if (!assetType) return [];
        const value = rowSchema.safeParse({
          symbol: row.symbol,
          name: row.name,
          assetType,
          currency: "USD",
          exchange: "United States",
          mic: "",
          timeZone: "America/New_York",
          isin: null,
        });
        return value.success ? [value.data] : [];
      });
    });
  }

  async references(type: "STOCK" | "ETF" | "CRYPTO" | "FUND") {
    if (!process.env.ALPHA_VANTAGE_API_KEY?.trim())
      throw new Error("MARKET_NOT_CONFIGURED");
    if (type === "CRYPTO")
      return (await this.coins()).flatMap((coin) =>
        currencies.map((currency) => ({
          symbol: `${coin.code}/${currency}`,
          currency_base: coin.name,
          available_exchanges: [ALPHA_PROVIDER],
        })),
      );
    if (type === "FUND") return [];
    return (await this.usListings())
      .filter((row) => row.assetType === type)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        currency: row.currency,
        exchange: row.exchange,
        mic_code: row.mic,
        exchange_timezone: row.timeZone,
        type: row.assetType === "ETF" ? "ETF" : "Common Stock",
      }));
  }

  async search(
    search: string,
    assetType?: Instrument["assetType"],
    currency = "EUR",
  ): Promise<InstrumentInput[]> {
    const text = search.trim().toUpperCase();
    let crypto: InstrumentInput[] = [];
    if (!assetType || assetType === "CRYPTO") {
      const coins = (await this.coins()).filter(
        (row) =>
          row.code.includes(text) || row.name.toUpperCase().includes(text),
      );
      const exact = coins.filter(
        (row) => row.code === text || row.name.toUpperCase() === text,
      );
      crypto = (exact.length ? exact : coins).slice(0, 50).map((coin) => ({
        symbol: `${coin.code}/${currency}`,
        name: coin.name,
        assetType: "CRYPTO",
        currency,
        exchange: ALPHA_PROVIDER,
        mic: "",
        timeZone: "UTC",
        isin: null,
      }));
      if (assetType === "CRYPTO" || exact.length) return crypto;
    }
    const key = createHash("sha256").update(text).digest("hex");
    const rows = await this.cached(
      `search:${key}`,
      86400000,
      rowsSchema,
      async () =>
        alphaSearchRows(
          await this.request("SYMBOL_SEARCH", { keywords: search.trim() }),
        ),
    );
    return [
      ...crypto,
      ...rows.filter(
        (row) =>
          (!assetType || row.assetType === assetType) &&
          row.currency === currency,
      ),
    ].slice(0, 50);
  }

  async matchLegacy(source: InstrumentInput): Promise<InstrumentInput | null> {
    if (source.assetType === "CRYPTO") {
      const base = source.symbol.split("/")[0]!;
      const rows = await this.search(base, "CRYPTO", source.currency);
      return (
        rows.find(
          (row) => row.symbol === `${base.toUpperCase()}/${source.currency}`,
        ) ?? null
      );
    }
    const regions: Record<string, { suffix: string; names: string[] }> = {
      XAMS: { suffix: ".AMS", names: ["Amsterdam", "Netherlands"] },
      XLON: { suffix: ".LON", names: ["United Kingdom"] },
      XETR: { suffix: ".DEX", names: ["Germany", "Frankfurt"] },
      XNAS: { suffix: "", names: ["United States"] },
      XNGS: { suffix: "", names: ["United States"] },
      XNYS: { suffix: "", names: ["United States"] },
      ARCX: { suffix: "", names: ["United States"] },
    };
    const region = regions[source.mic];
    if (!region) return null;
    const symbol = source.symbol.toUpperCase().endsWith(region.suffix)
      ? source.symbol.toUpperCase()
      : `${source.symbol.toUpperCase()}${region.suffix}`;
    const rows = await this.search(
      source.symbol,
      source.assetType,
      source.currency,
    );
    const matches = rows.filter(
      (row) =>
        row.symbol.toUpperCase() === symbol &&
        row.assetType === source.assetType &&
        row.currency === source.currency &&
        region.names.includes(row.exchange),
    );
    return matches.length === 1 ? matches[0]! : null;
  }

  private validate(mapping: InstrumentMapping, instrument: Instrument) {
    if (mapping.provider !== ALPHA_PROVIDER) throw new Error("MARKET_UNMAPPED");
    if (
      mapping.currency !== instrument.currency ||
      mapping.symbol.toUpperCase() !== instrument.symbol.toUpperCase() ||
      mapping.exchange.toUpperCase() !== instrument.exchange.toUpperCase() ||
      mapping.mic !== instrument.mic
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
  }
  async current(
    mapping: InstrumentMapping,
    instrument: Instrument,
  ): Promise<ProviderPrice> {
    return this.close(mapping, instrument);
  }
  async close(
    mapping: InstrumentMapping,
    instrument: Instrument,
  ): Promise<ProviderPrice> {
    this.validate(mapping, instrument);
    if (instrument.assetType === "CRYPTO") return this.cryptoPrice(mapping);
    const body = await this.request("TIME_SERIES_DAILY", {
      symbol: mapping.symbol,
      outputsize: "compact",
    });
    const parsed = z
      .object({
        "Meta Data": z.object({
          "2. Symbol": z.string(),
          "5. Time Zone": timeZoneSchema,
        }),
        "Time Series (Daily)": z.record(
          z.iso.date(),
          z.object({ "4. close": priceValue }),
        ),
      })
      .safeParse(body);
    if (!parsed.success) throw new Error("MARKET_UNAVAILABLE");
    if (
      parsed.data["Meta Data"]["2. Symbol"].toUpperCase() !==
      mapping.symbol.toUpperCase()
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
    for (const date of Object.keys(parsed.data["Time Series (Daily)"])
      .sort()
      .reverse()) {
      const available = DateTime.fromISO(date, {
        zone: parsed.data["Meta Data"]["5. Time Zone"],
      })
        .plus({ days: 1 })
        .startOf("day")
        .toUTC();
      if (!available.isValid || available.toMillis() > Date.now()) continue;
      return {
        price: decimal(
          parsed.data["Time Series (Daily)"][date]!["4. close"],
        ).toFixed(),
        currency: mapping.currency,
        provider: ALPHA_PROVIDER,
        kind: "CLOSE",
        marketAt: null,
        tradingDate: new Date(`${date}T00:00:00Z`),
        availableAt: available.toJSDate(),
        fetchedAt: new Date(),
      };
    }
    throw new Error("MARKET_UNAVAILABLE");
  }
  private async cryptoPrice(
    mapping: InstrumentMapping,
  ): Promise<ProviderPrice> {
    const [base, currency] = mapping.symbol.split("/");
    if (!base || currency !== mapping.currency)
      throw new Error("MARKET_IDENTITY_MISMATCH");
    const body = await this.request("CURRENCY_EXCHANGE_RATE", {
      from_currency: base,
      to_currency: mapping.currency,
    });
    const parsed = z
      .object({
        "Realtime Currency Exchange Rate": z.object({
          "1. From_Currency Code": z.string(),
          "3. To_Currency Code": z.string(),
          "5. Exchange Rate": priceValue,
          "6. Last Refreshed": z.string(),
          "7. Time Zone": timeZoneSchema,
        }),
      })
      .safeParse(body);
    if (!parsed.success) throw new Error("MARKET_UNAVAILABLE");
    const quote = parsed.data["Realtime Currency Exchange Rate"];
    if (
      quote["1. From_Currency Code"].toUpperCase() !== base ||
      quote["3. To_Currency Code"].toUpperCase() !== mapping.currency
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
    const date = DateTime.fromFormat(
      quote["6. Last Refreshed"],
      "yyyy-MM-dd HH:mm:ss",
      { zone: quote["7. Time Zone"] },
    );
    if (!date.isValid || date.toMillis() > Date.now() + 60000)
      throw new Error("MARKET_UNAVAILABLE");
    return {
      price: decimal(quote["5. Exchange Rate"]).toFixed(),
      currency: mapping.currency,
      provider: ALPHA_PROVIDER,
      kind: "QUOTE",
      marketAt: date.toJSDate(),
      tradingDate: new Date(`${date.toUTC().toISODate()}T00:00:00Z`),
      availableAt: date.toJSDate(),
      fetchedAt: new Date(),
    };
  }
}
