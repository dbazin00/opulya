import { Inject, Injectable } from "@nestjs/common";
import { decimal } from "@opulya/shared";
import type { Asset } from "./generated/prisma/client.js";
import { Database } from "./db.js";
import {
  InstrumentProvider,
  InstrumentsService,
  instrumentIdentity,
  marketError,
  MARKET_PROVIDER_NAME,
} from "./instruments.js";
import { marketDataEnabled, type ProviderPrice } from "./yahoo-finance.js";

const freshMs = 60_000;
const fallbackMs = 24 * 3600_000;
const maxEntries = 500;
type Cached = {
  checkedAt: number;
  quote: MarketPrice | null;
  error: string | null;
};

@Injectable()
export class MarketDataService {
  // Public quotes only, shared across users in this API process.
  private readonly cache = new Map<string, Cached>();
  private readonly pending = new Map<string, Promise<PriceResult>>();
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(InstrumentProvider) private readonly external: InstrumentProvider,
    @Inject(InstrumentsService)
    private readonly instruments: InstrumentsService,
  ) {}
  async getCurrentPrice(asset: Asset): Promise<PriceResult> {
    if (!marketDataEnabled())
      return { quote: null, error: "MARKET_NOT_CONFIGURED" };
    let instrumentId =
      asset.instrumentId ??
      (
        await this.db.instrument.findUnique({
          where: {
            identity: instrumentIdentity({
              ...asset,
              symbol: marketDataSymbol(asset),
            }),
          },
          select: { id: true },
        })
      )?.id;
    if (!instrumentId) return { quote: null, error: "MARKET_UNMAPPED" };
    const readMapping = () =>
      this.db.instrumentMapping.findUnique({
        where: {
          instrumentId_provider: {
            instrumentId: instrumentId!,
            provider: MARKET_PROVIDER_NAME,
          },
        },
        include: { instrument: true },
      });
    let mapping = await readMapping();
    if (!mapping) {
      try {
        await this.instruments.linkLegacy(asset);
        instrumentId =
          (
            await this.db.asset.findFirst({
              where: { id: asset.id, userId: asset.userId },
              select: { instrumentId: true },
            })
          )?.instrumentId ?? instrumentId;
        mapping = await readMapping();
      } catch (error) {
        return { quote: null, error: marketError(error) };
      }
    }
    if (!mapping) return { quote: null, error: "MARKET_UNMAPPED" };
    if (
      mapping.currency !== asset.currency ||
      mapping.instrument.currency !== asset.currency ||
      mapping.instrument.assetType !== asset.assetType
    )
      return { quote: null, error: "MARKET_IDENTITY_MISMATCH" };
    const key = JSON.stringify([
      instrumentId,
      mapping.provider,
      mapping.symbol,
      mapping.exchange,
      mapping.mic,
      mapping.currency,
    ]);
    const saved = this.cache.get(key);
    const now = Date.now();
    if (
      saved &&
      now - saved.checkedAt < freshMs &&
      (saved.error ||
        (saved.quote && now - Date.parse(saved.quote.fetchedAt) < freshMs))
    )
      return this.result(saved);
    const active = this.pending.get(key);
    if (active) return active;
    if (this.pending.size >= maxEntries)
      return { quote: null, error: "MARKET_RATE_LIMIT" };
    const work = (async () => {
      let entry: Cached;
      try {
        const value = await this.external.current(mapping, mapping.instrument);
        const quote = this.normalize(value, asset.currency);
        entry = { quote, checkedAt: Date.now(), error: null };
      } catch (error) {
        const code = marketError(error);
        const transient = [
          "MARKET_UNAVAILABLE",
          "MARKET_RATE_LIMIT",
          "MARKET_AUTH_FAILED",
        ].includes(code);
        const quote =
          transient &&
          saved?.quote &&
          Date.now() - Date.parse(saved.quote.fetchedAt) < fallbackMs
            ? saved.quote
            : null;
        entry = { quote, checkedAt: Date.now(), error: code };
      }
      this.cache.delete(key);
      if (this.cache.size >= maxEntries)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, entry);
      return this.result(entry);
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }
  private normalize(value: ProviderPrice, currency: string): MarketPrice {
    let price;
    try {
      price = decimal(value.price);
    } catch {
      throw new Error("MARKET_IDENTITY_MISMATCH");
    }
    if (
      value.provider !== MARKET_PROVIDER_NAME ||
      value.currency !== currency ||
      value.kind !== "QUOTE" ||
      !price.isFinite() ||
      !price.gt(0) ||
      !Number.isFinite(value.fetchedAt.getTime()) ||
      value.fetchedAt.getTime() > Date.now() ||
      (value.marketAt &&
        (!Number.isFinite(value.marketAt.getTime()) ||
          value.marketAt.getTime() > Date.now()))
    )
      throw new Error("MARKET_IDENTITY_MISMATCH");
    return {
      price: price.toFixed(),
      currency,
      fetchedAt: value.fetchedAt.toISOString(),
      marketAt: value.marketAt?.toISOString() ?? null,
      provider: value.provider,
      kind: "QUOTE",
      delayed: value.delayMinutes !== 0,
      delayMinutes: value.delayMinutes ?? null,
      marketState: value.marketState ?? null,
      stale: false,
    };
  }
  private result(entry: Cached): PriceResult {
    if (!entry.quote) return { quote: null, error: entry.error };
    const quote = entry.quote;
    const marketAge = quote.marketAt
      ? Date.now() - Date.parse(quote.marketAt)
      : 0;
    const closed = ["CLOSED", "PRE", "POST", "PREPRE", "POSTPOST"].includes(
      quote.marketState ?? "",
    );
    const stale =
      !!entry.error ||
      Date.now() - Date.parse(quote.fetchedAt) > freshMs + 5000 ||
      marketAge >
        (closed ? 7 * 86400_000 : (15 + (quote.delayMinutes ?? 15)) * 60_000);
    return { quote: { ...quote, stale }, error: entry.error };
  }
}

export interface MarketPrice {
  kind: "QUOTE";
  price: string;
  currency: string;
  fetchedAt: string;
  marketAt: string | null;
  provider: string;
  delayed: boolean;
  delayMinutes: number | null;
  marketState: string | null;
  stale: boolean;
}
export type PriceResult = { quote: MarketPrice | null; error: string | null };
export function marketDataSymbol(asset: Asset) {
  const symbol = (asset.marketDataIdentifier || asset.symbol).trim();
  return asset.assetType === "CRYPTO"
    ? (symbol.includes("/")
        ? symbol
        : symbol + "/" + asset.currency
      ).toUpperCase()
    : symbol;
}
