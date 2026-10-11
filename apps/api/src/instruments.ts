import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DateTime } from "luxon";
import { AlphaVantageProvider, ALPHA_PROVIDER } from "./alpha-vantage.js";
import { assetSchema, assetTypes, currencySchema, z } from "@opulya/shared";
import { Database } from "./db.js";
import {
  Prisma,
  type Asset,
  type Instrument,
} from "./generated/prisma/client.js";

export const MARKET_PROVIDER_NAME = ALPHA_PROVIDER;
const provider = MARKET_PROVIDER_NAME;
export const discoverySchema = z
  .object({
    search: z.string().trim().min(3).max(80),
    assetType: z.enum(assetTypes).optional(),
    currency: currencySchema.optional(),
  })
  .strict();
export const catalogueSchema = z
  .object({
    search: z.string().trim().max(80).default(""),
    currency: currencySchema.optional(),
    assetType: z.enum(assetTypes).optional(),
  })
  .strict();
export const selectInstrumentSchema = z
  .object({ instrumentId: z.string().min(1).max(64) })
  .strict();
const searchRow = z.object({
  symbol: z.string(),
  instrument_name: z.string(),
  instrument_type: z.string(),
  exchange: z.string().default(""),
  mic_code: z.string().default(""),
  currency: z.string().default(""),
  exchange_timezone: z.string().default("UTC"),
  isin: z.string().optional(),
});
export type InstrumentInput = Pick<
  Instrument,
  | "name"
  | "symbol"
  | "assetType"
  | "exchange"
  | "mic"
  | "currency"
  | "timeZone"
  | "isin"
>;
export function catalogueChoices<
  T extends Pick<
    InstrumentInput,
    "symbol" | "currency" | "assetType" | "exchange"
  >,
>(rows: readonly T[]): T[] {
  const choices: T[] = [];
  const crypto = new Map<string, number>();
  const sources = ["BINANCE", "KRAKEN", "COINBASE PRO", "BITSTAMP"];
  const rank = (row: T) => {
    const index = sources.indexOf(row.exchange.toUpperCase());
    return index < 0 ? sources.length : index;
  };
  for (const row of rows) {
    if (row.assetType !== "CRYPTO") {
      choices.push(row);
      continue;
    }
    const key = `${row.symbol.toUpperCase()}:${row.currency}`;
    const index = crypto.get(key);
    if (index === undefined) {
      crypto.set(key, choices.length);
      choices.push(row);
    } else if (
      rank(row) < rank(choices[index]!) ||
      (rank(row) === rank(choices[index]!) &&
        row.exchange.localeCompare(choices[index]!.exchange, "en") < 0)
    )
      choices[index] = row;
  }
  return choices;
}
export function exactCryptoChoices<
  T extends Pick<InstrumentInput, "name" | "symbol">,
>(rows: T[], search: string): T[] {
  const query = search.trim().toUpperCase();
  if (!query) return rows;
  const exact = rows.filter(
    (row) =>
      row.name.toUpperCase() === query ||
      row.symbol.toUpperCase() === query ||
      row.symbol.split("/")[0]?.toUpperCase() === query,
  );
  return exact.length ? exact : rows;
}
export function instrumentIdentity(
  input: Pick<
    InstrumentInput,
    "symbol" | "assetType" | "exchange" | "currency"
  > & { mic?: string },
) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.assetType,
        input.symbol.toUpperCase(),
        input.exchange.toUpperCase(),
        input.mic?.toUpperCase() ?? "",
        input.currency,
      ]),
    )
    .digest("hex");
}
const searchTypes: Record<string, Asset["assetType"]> = {
  "Common Stock": "STOCK",
  "Preferred Stock": "STOCK",
  REIT: "STOCK",
  "American Depositary Receipt": "STOCK",
  "Depositary Receipt": "STOCK",
  "Global Depositary Receipt": "STOCK",
  ETF: "ETF",
  "Mutual Fund": "FUND",
  "Digital Currency": "CRYPTO",
};
export function searchInstrument(value: unknown): InstrumentInput | null {
  const row = searchRow.safeParse(value);
  if (!row.success) return null;
  const r = row.data;
  const assetType = searchTypes[r.instrument_type];
  if (!assetType) return null;
  const currency =
    r.currency ||
    (assetType === "CRYPTO" ? (r.symbol.split("/")[1] ?? "") : "");
  const parsed = assetSchema.safeParse({
    symbol: r.symbol,
    name: r.instrument_name,
    assetType,
    exchange: r.exchange,
    currency,
  });
  if (
    !parsed.success ||
    (assetType === "CRYPTO" &&
      r.symbol.split("/")[1]?.toUpperCase() !== currency.toUpperCase())
  )
    return null;
  // Reference feeds may use a type marker instead of an ISO exchange MIC.
  const mic =
    assetType === "CRYPTO" && r.mic_code === "DIGITAL_CURRENCY"
      ? ""
      : r.mic_code;
  if (mic && !/^[A-Za-z0-9]{4}$/.test(mic)) return null;
  if (
    r.exchange_timezone !== "UTC" &&
    !DateTime.now().setZone(r.exchange_timezone).isValid
  )
    return null;
  return {
    ...parsed.data,
    mic: mic.toUpperCase(),
    timeZone: r.exchange_timezone,
    isin: r.isin && /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r.isin) ? r.isin : null,
  };
}
export function marketError(error: unknown) {
  return error instanceof Error && /^MARKET_[A-Z_]+$/.test(error.message)
    ? error.message
    : "MARKET_UNAVAILABLE";
}

@Injectable()
export class MarketBudget {
  constructor(@Inject(Database) private readonly db: Database) {}
  async reserve() {
    const now = Date.now();
    const windows = [
      {
        key: `alpha-vantage:minute:${Math.floor(now / 60000)}`,
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(process.env.MARKET_REQUESTS_PER_MINUTE ?? 5),
      },
      {
        key: `alpha-vantage:day:${Math.floor(now / 86400000)}`,
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(process.env.MARKET_REQUESTS_PER_DAY ?? 25),
      },
    ];
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.$transaction(
          async (tx) => {
            for (const { key, limit } of windows) {
              const row = await tx.marketQuota.upsert({
                where: { key },
                create: { key, count: 1 },
                update: { count: { increment: 1 } },
              });
              if (row.count > limit) throw new Error("MARKET_RATE_LIMIT");
            }
          },
          { isolationLevel: "Serializable" },
        );
        await this.pace();
        return;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ["P2034", "P2002"].includes(error.code) &&
          attempt < 5
        )
          continue;
        throw error;
      }
    }
  }
  private async pace() {
    const id = "alpha-vantage:request-pace";
    await this.db.marketJob.upsert({
      where: { id },
      create: { id, leaseUntil: new Date(0) },
      update: {},
    });
    for (let i = 0; i < 100; i++) {
      const now = new Date();
      const locked = await this.db.marketJob.updateMany({
        where: { id, leaseUntil: { lte: now } },
        data: { leaseUntil: new Date(now.getTime() + 1300) },
      });
      if (locked.count) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("MARKET_RATE_LIMIT");
  }
}

@Injectable()
export class InstrumentProvider extends AlphaVantageProvider {
  constructor(
    @Inject(MarketBudget) budget: MarketBudget,
    @Inject(Database) db?: Database,
  ) {
    super(budget, db);
  }
}

@Injectable()
export class InstrumentsService {
  private readonly searches = new Map<
    string,
    { at: number; results: Instrument[] }
  >();
  private readonly pending = new Map<string, Promise<Instrument[]>>();
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(InstrumentProvider) private readonly external: InstrumentProvider,
  ) {}
  async available<
    T extends Pick<
      InstrumentInput,
      "symbol" | "assetType" | "exchange" | "currency"
    >,
  >(userId: string, rows: readonly T[]) {
    const owned = await this.db.asset.findMany({
      where: { userId },
      select: {
        symbol: true,
        assetType: true,
        exchange: true,
        currency: true,
        marketDataIdentifier: true,
        instrument: {
          select: {
            symbol: true,
            assetType: true,
            exchange: true,
            currency: true,
          },
        },
      },
    });
    const key = (
      row:
        | T
        | Pick<
            InstrumentInput,
            "symbol" | "assetType" | "exchange" | "currency"
          >,
    ) => {
      const symbol = row.symbol.trim().toUpperCase();
      return JSON.stringify([
        row.assetType,
        row.assetType === "CRYPTO" && !symbol.includes("/")
          ? `${symbol}/${row.currency}`
          : symbol,
        row.assetType === "CRYPTO" ? "" : row.exchange.trim().toUpperCase(),
        row.currency,
      ]);
    };
    const keys = new Set(
      owned.map((asset) =>
        key(
          asset.instrument ?? {
            ...asset,
            symbol: asset.marketDataIdentifier || asset.symbol,
          },
        ),
      ),
    );
    const items = rows.filter((row) => !keys.has(key(row)));
    return { items, ownedCount: rows.length - items.length };
  }
  async list(query: z.infer<typeof catalogueSchema>) {
    const rows = await this.db.instrument.findMany({
      where: {
        mappings: { some: { provider } },
        ...(query.currency ? { currency: query.currency } : {}),
        ...(query.assetType ? { assetType: query.assetType } : {}),
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { symbol: { contains: query.search, mode: "insensitive" } },
          { isin: { equals: query.search.toUpperCase() } },
        ],
      },
      orderBy: [{ symbol: "asc" }, { exchange: "asc" }],
      take: 100,
    });
    const choices = catalogueChoices(rows);
    return (
      query.assetType === "CRYPTO"
        ? exactCryptoChoices(choices, query.search)
        : choices
    ).slice(0, 50);
  }
  async remember(input: InstrumentInput, refreshName = false) {
    const identity = instrumentIdentity(input);
    const instrument = await this.db.instrument.upsert({
      where: { identity },
      update: refreshName ? { name: input.name } : {},
      create: {
        name: input.name,
        symbol: input.symbol,
        assetType: input.assetType,
        exchange: input.exchange,
        mic: input.mic,
        currency: input.currency,
        timeZone: input.timeZone,
        isin: input.isin,
        identity,
        mappings: {
          create: {
            provider,
            symbol: input.symbol,
            exchange: input.exchange,
            mic: input.mic,
            currency: input.currency,
          },
        },
      },
    });
    await this.db.instrumentMapping.upsert({
      where: {
        instrumentId_provider: { instrumentId: instrument.id, provider },
      },
      create: {
        instrumentId: instrument.id,
        provider,
        symbol: input.symbol,
        exchange: input.exchange,
        mic: input.mic,
        currency: input.currency,
      },
      update: {},
    });
    return instrument;
  }
  async discover(
    search: string,
    assetType?: Asset["assetType"],
    currency?: string,
  ) {
    const key = JSON.stringify([search.toUpperCase(), assetType, currency]);
    const cached = this.searches.get(key);
    if (cached && Date.now() - cached.at < 86400000) return cached.results;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const work = (async () => {
      try {
        const results: Instrument[] = [];
        for (const input of catalogueChoices(
          await this.external.search(search, assetType, currency),
        ))
          if (
            (!assetType || input.assetType === assetType) &&
            (!currency || input.currency === currency)
          )
            results.push(await this.remember(input, assetType === "CRYPTO"));
        if (this.searches.size >= 200)
          this.searches.delete(this.searches.keys().next().value!);
        this.searches.set(key, { at: Date.now(), results });
        return results;
      } catch (error) {
        throw new ServiceUnavailableException(marketError(error));
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, work);
    return work;
  }
  async select(userId: string, instrumentId: string) {
    let instrument = await this.db.instrument.findFirst({
      where: { id: instrumentId, mappings: { some: { provider } } },
    });
    if (!instrument) throw new NotFoundException("NOT_FOUND");
    if (instrument.assetType === "CRYPTO") {
      const variants = await this.db.instrument.findMany({
        where: {
          assetType: "CRYPTO",
          symbol: instrument.symbol,
          currency: instrument.currency,
          mappings: { some: { provider } },
        },
      });
      instrument = catalogueChoices(variants)[0] ?? instrument;
      instrumentId = instrument.id;
      {
        const existing = await this.db.asset.findFirst({
          where: {
            userId,
            assetType: "CRYPTO",
            currency: instrument.currency,
            instrumentId: { in: variants.map((row) => row.id) },
          },
          orderBy: { createdAt: "asc" },
        });
        if (existing) return existing;
      }
    }
    const mapped = await this.db.asset.findFirst({
      where: {
        userId,
        instrumentId,
        assetType: instrument.assetType,
        currency: instrument.currency,
      },
      orderBy: { createdAt: "asc" },
    });
    if (mapped) return mapped;
    const where = {
      userId_symbol_exchange_currency: {
        userId,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        currency: instrument.currency,
      },
    };
    const existing = await this.db.asset.findUnique({ where });
    if (
      existing &&
      (existing.assetType !== instrument.assetType ||
        existing.instrumentId !== instrumentId)
    )
      throw new BadRequestException("MARKET_IDENTITY_MISMATCH");
    return this.db.asset.upsert({
      where,
      update: {},
      create: {
        userId,
        instrumentId,
        symbol: instrument.symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        currency: instrument.currency,
        assetType: instrument.assetType,
        marketDataIdentifier: instrument.symbol,
      },
    });
  }
  async requestCurrent(userId: string, assetId: string) {
    const asset = await this.db.asset.findFirst({
      where: { id: assetId, userId },
    });
    if (!asset) throw new NotFoundException("NOT_FOUND");
    if (!asset.instrumentId) throw new BadRequestException("MARKET_UNMAPPED");
    const price = await this.db.latestPrice.findUnique({
      where: { instrumentId: asset.instrumentId },
    });
    const validPrice =
      price &&
      price.currency === asset.currency &&
      price.provider === provider &&
      price.availableAt <= new Date() &&
      price.price.gt(0);
    // Adding a private reference must never refresh an already-priced shared instrument.
    if (validPrice) return { ok: true, cached: true };
    const mapping = await this.db.instrumentMapping.findUnique({
      where: {
        instrumentId_provider: { instrumentId: asset.instrumentId, provider },
      },
    });
    if (
      mapping?.error &&
      mapping.lastAttemptAt &&
      mapping.lastAttemptAt.getTime() > Date.now() - 3600000
    ) {
      return { ok: true, cached: false };
    }
    // A shared instrument has one durable request; repeated user clicks cannot create a queue.
    await this.db.instrumentMapping.updateMany({
      where: {
        instrumentId: asset.instrumentId,
        provider,
        instrument: {
          OR: [
            { latestPrice: { is: null } },
            {
              latestPrice: { is: { currency: { not: asset.currency } } },
            },
            { latestPrice: { is: { provider: { not: provider } } } },
            { latestPrice: { is: { availableAt: { gt: new Date() } } } },
            { latestPrice: { is: { price: { lte: 0 } } } },
          ],
        },
        OR: [
          { currentRequestedAt: null },
          { currentRequestedAt: { lt: new Date(Date.now() - 60_000) } },
        ],
      },
      data: { currentRequestedAt: new Date(), error: null },
    });
    return { ok: true, cached: false };
  }
  async linkLegacy(asset: Asset) {
    const source = asset.instrumentId
      ? await this.db.instrument.findUnique({
          where: { id: asset.instrumentId },
        })
      : null;
    if (!source) return;
    const matched = await this.external.matchLegacy(source);
    if (!matched) return;
    const target = await this.remember(matched);
    const changed = await this.db.asset.updateMany({
      where: {
        id: asset.id,
        userId: asset.userId,
        instrumentId: asset.instrumentId,
        assetType: matched.assetType,
        currency: matched.currency,
      },
      data: { instrumentId: target.id },
    });
    if (changed.count) await this.requestCurrent(asset.userId, asset.id);
  }
  async removeAsset(userId: string, id: string) {
    return this.db.atomic(userId, async (tx) => {
      const asset = await tx.asset.findFirst({ where: { id, userId } });
      if (!asset) throw new NotFoundException("NOT_FOUND");
      if (
        await tx.investmentTransaction.findFirst({
          where: { userId, assetId: id },
          select: { id: true },
        })
      )
        throw new ConflictException("ASSET_HAS_TRANSACTIONS");
      await tx.asset.delete({ where: { id, userId } });
      return { ok: true };
    });
  }
}

export function dailyCycle(now = new Date()) {
  const cycle = DateTime.fromJSDate(now, { zone: "UTC" })
    .startOf("day")
    .plus({ hours: 12 });
  return (
    cycle.toMillis() > now.getTime() ? cycle.minus({ days: 1 }) : cycle
  ).toJSDate();
}
@Injectable()
export class MarketPriceSync {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(InstrumentsService)
    private readonly instruments: InstrumentsService,
    @Inject(InstrumentProvider) private readonly external: InstrumentProvider,
  ) {}
  async run() {
    if (!process.env.ALPHA_VANTAGE_API_KEY?.trim())
      return { updated: 0, skipped: "MARKET_NOT_CONFIGURED" };
    const id = "latest-prices",
      token = randomUUID();
    await this.db.marketJob.upsert({
      where: { id },
      create: { id, leaseUntil: new Date(0) },
      update: {},
    });
    const locked = await this.db.marketJob.updateMany({
      where: { id, leaseUntil: { lt: new Date() } },
      data: { token, leaseUntil: new Date(Date.now() + 300000) },
    });
    if (!locked.count) return { updated: 0, skipped: "BUSY" };
    let updated = 0;
    try {
      for (const asset of await this.db.asset.findMany({
        where: {
          OR: [
            { instrumentId: null },
            { instrument: { mappings: { none: { provider } } } },
          ],
        },
      })) {
        try {
          await this.instruments.linkLegacy(asset);
        } catch (error) {
          if (
            [
              "MARKET_RATE_LIMIT",
              "MARKET_NOT_CONFIGURED",
              "MARKET_AUTH_FAILED",
            ].includes(marketError(error))
          )
            break;
        }
      }
      const assets = await this.db.asset.findMany({
        where: { instrumentId: { not: null } },
        select: { instrumentId: true },
      });
      const mappings = await this.db.instrumentMapping.findMany({
        where: {
          provider,
          instrumentId: { in: assets.map((a) => a.instrumentId!) },
          AND: [
            {
              OR: [
                { lastSuccessAt: null },
                { lastSuccessAt: { lt: dailyCycle() } },
                { currentRequestedAt: { not: null } },
              ],
            },
            {
              OR: [
                { lastAttemptAt: null },
                { lastAttemptAt: { lt: new Date(Date.now() - 3600000) } },
                { currentRequestedAt: { not: null }, error: null },
              ],
            },
          ],
        },
        include: { instrument: true },
        orderBy: { lastAttemptAt: { sort: "asc", nulls: "first" } },
        take: 40,
      });
      for (const mapping of mappings) {
        const renewed = await this.db.marketJob.updateMany({
          where: { id, token, leaseUntil: { gt: new Date() } },
          data: { leaseUntil: new Date(Date.now() + 300000) },
        });
        if (!renewed.count) break;
        try {
          const close = mapping.currentRequestedAt
            ? await this.external.current(mapping, mapping.instrument)
            : await this.external.close(mapping, mapping.instrument);
          await this.db.$transaction(async (tx) => {
            const previous = await tx.latestPrice.findUnique({
              where: { instrumentId: mapping.instrumentId },
            });
            const older =
              previous &&
              previous.provider === provider &&
              (previous.tradingDate > close.tradingDate ||
                (previous.kind === "QUOTE" &&
                  close.kind === "QUOTE" &&
                  previous.marketAt &&
                  close.marketAt &&
                  previous.marketAt > close.marketAt));
            if (
              older &&
              !(previous?.kind === "QUOTE" && close.kind === "CLOSE")
            )
              throw new Error("MARKET_UNAVAILABLE");
            if (!older)
              await tx.latestPrice.upsert({
                where: {
                  instrumentId: mapping.instrumentId,
                },
                create: { ...close, instrumentId: mapping.instrumentId },
                update: close,
              });
            await tx.instrumentMapping.update({
              where: { id: mapping.id },
              data: {
                lastAttemptAt: close.fetchedAt,
                lastSuccessAt: close.fetchedAt,
                error: null,
              },
            });
            if (mapping.currentRequestedAt)
              await tx.instrumentMapping.updateMany({
                where: {
                  id: mapping.id,
                  currentRequestedAt: mapping.currentRequestedAt,
                },
                data: { currentRequestedAt: null },
              });
          });
          updated++;
        } catch (error) {
          const code = marketError(error);
          if (code === "MARKET_RATE_LIMIT") {
            await this.db.instrumentMapping.update({
              where: { id: mapping.id },
              data: { error: code },
            });
            break;
          }
          await this.db.instrumentMapping.update({
            where: { id: mapping.id },
            data: { lastAttemptAt: new Date(), error: code },
          });
          if (["MARKET_AUTH_FAILED", "MARKET_NOT_CONFIGURED"].includes(code))
            break;
        }
      }
      const minute = Math.floor(Date.now() / 60000),
        day = Math.floor(Date.now() / 86400000);
      await this.db.marketQuota.deleteMany({
        where: {
          OR: [
            {
              AND: [
                { key: { startsWith: "alpha-vantage:minute:" } },
                { key: { lt: `alpha-vantage:minute:${minute - 1440}` } },
              ],
            },
            {
              AND: [
                { key: { startsWith: "alpha-vantage:day:" } },
                { key: { lt: `alpha-vantage:day:${day - 7}` } },
              ],
            },
          ],
        },
      });
      return { updated, considered: mappings.length };
    } finally {
      await this.db.marketJob.updateMany({
        where: { id, token },
        data: { token: null, leaseUntil: new Date(0) },
      });
    }
  }
}
