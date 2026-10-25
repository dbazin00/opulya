import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  YahooFinanceProvider,
  YAHOO_PROVIDER,
  yahooSymbol,
  cryptoBase,
} from "./yahoo-finance.js";
import { z } from "@opulya/shared";
import { Database } from "./db.js";
import {
  Prisma,
  type Asset,
  type Instrument,
} from "./generated/prisma/client.js";

export const MARKET_PROVIDER_NAME = YAHOO_PROVIDER;
const provider = MARKET_PROVIDER_NAME;
export const selectInstrumentSchema = z
  .object({
    instrumentId: z.string().min(1).max(64),
  })
  .strict();
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
> & { exchangeName?: string | null };
export function catalogueChoices<
  T extends Pick<
    InstrumentInput,
    "symbol" | "currency" | "assetType" | "exchange"
  >,
>(rows: readonly T[]): T[] {
  const choices: T[] = [];
  const crypto = new Map<string, number>();
  for (const row of rows) {
    if (row.assetType !== "CRYPTO") {
      choices.push(row);
      continue;
    }
    const key = `${cryptoBase(row.symbol, row.currency)}:${row.currency}`;
    const index = crypto.get(key);
    if (index === undefined) {
      crypto.set(key, choices.length);
      choices.push(row);
    } else if (row.exchange.localeCompare(choices[index]!.exchange, "en") < 0)
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
export function marketError(error: unknown) {
  return error instanceof Error && /^MARKET_[A-Z_]+$/.test(error.message)
    ? error.message
    : "MARKET_UNAVAILABLE";
}

@Injectable()
export class MarketBudget {
  private lastCleanupAt = 0;
  constructor(@Inject(Database) private readonly db: Database) {}
  async block() {
    const id = "yahoo:provider-backoff";
    await this.db.marketJob.upsert({
      where: { id },
      create: { id, leaseUntil: new Date(Date.now() + 60000) },
      update: { leaseUntil: new Date(Date.now() + 60000) },
    });
  }
  async reserve() {
    const blocked = await this.db.marketJob.findUnique({
      where: { id: "yahoo:provider-backoff" },
    });
    if (blocked && blocked.leaseUntil > new Date())
      throw new Error("MARKET_RATE_LIMIT");
    const now = Date.now();
    const windows = [
      {
        key: `yahoo:minute:${Math.floor(now / 60000)}`,
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(10000)
          .parse(process.env.MARKET_REQUESTS_PER_MINUTE ?? 30),
      },
      {
        key: `yahoo:day:${Math.floor(now / 86400000)}`,
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(100000)
          .parse(process.env.MARKET_REQUESTS_PER_DAY ?? 1000),
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
        if (Date.now() - this.lastCleanupAt > 3600000) {
          this.lastCleanupAt = Date.now();
          const minute = Math.floor(Date.now() / 60000),
            day = Math.floor(Date.now() / 86400000);
          await this.db.marketQuota
            .deleteMany({
              where: {
                OR: [
                  {
                    AND: [
                      { key: { startsWith: "yahoo:minute:" } },
                      { key: { lt: `yahoo:minute:${minute - 1440}` } },
                    ],
                  },
                  {
                    AND: [
                      { key: { startsWith: "yahoo:day:" } },
                      { key: { lt: `yahoo:day:${day - 7}` } },
                    ],
                  },
                ],
              },
            })
            .catch(() => console.warn("Market quota cleanup failed"));
        }
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
    const id = "yahoo:request-pace";
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
export class InstrumentProvider extends YahooFinanceProvider {
  constructor(
    @Inject(MarketBudget) budget: MarketBudget,
    @Inject(Database) db?: Database,
  ) {
    super(budget, db);
  }
}

@Injectable()
export class InstrumentsService {
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
        row.assetType === "CRYPTO"
          ? `${cryptoBase(symbol, row.currency)}/${row.currency}`
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
  async remember(input: InstrumentInput, refreshName = false) {
    const identity = instrumentIdentity(input);
    const instrument = await this.db.instrument.upsert({
      where: { identity },
      update: {
        ...(refreshName ? { name: input.name } : {}),
        ...(input.exchangeName ? { exchangeName: input.exchangeName } : {}),
        ...(input.isin ? { isin: input.isin } : {}),
      },
      create: {
        name: input.name,
        symbol: input.symbol,
        assetType: input.assetType,
        exchange: input.exchange,
        exchangeName: input.exchangeName,
        mic: input.mic,
        currency: input.currency,
        timeZone: input.timeZone,
        isin: input.isin,
        identity,
        mappings: {
          create: {
            provider,
            symbol: yahooSymbol(input),
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
        symbol: yahooSymbol(input),
        exchange: input.exchange,
        mic: input.mic,
        currency: input.currency,
      },
      update: {},
    });
    return instrument;
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
    return this.db.atomic(userId, (tx) =>
      tx.asset.upsert({
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
      }),
    );
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
    await this.db.asset.updateMany({
      where: {
        id: asset.id,
        userId: asset.userId,
        user: { processingRestrictedAt: null },
        instrumentId: asset.instrumentId,
        assetType: matched.assetType,
        currency: matched.currency,
      },
      data: { instrumentId: target.id },
    });
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
      if (
        await tx.budget.findFirst({
          where: { userId, assetId: id },
          select: { id: true },
        })
      )
        throw new ConflictException("ASSET_HAS_BUDGETS");
      await tx.asset.delete({ where: { id, userId } });
      return { ok: true };
    });
  }
}
