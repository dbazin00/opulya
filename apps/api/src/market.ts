import { Inject, Injectable } from "@nestjs/common";
import type { Asset } from "./generated/prisma/client.js";
import { Database } from "./db.js";
import { instrumentIdentity, MARKET_PROVIDER_NAME } from "./instruments.js";

@Injectable()
export class MarketDataService {
  constructor(@Inject(Database) private readonly db: Database) {}
  async getCurrentPrice(asset: Asset): Promise<PriceResult> {
    const instrumentId =
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
    const missing = process.env.ALPHA_VANTAGE_API_KEY?.trim()
      ? "MARKET_PRICE_PENDING"
      : "MARKET_NOT_CONFIGURED";
    if (!instrumentId)
      return {
        quote: null,
        error:
          missing === "MARKET_NOT_CONFIGURED" ? missing : "MARKET_UNMAPPED",
      };
    const price = await this.db.latestPrice.findUnique({
      where: { instrumentId },
    });
    const mapping = await this.db.instrumentMapping.findUnique({
      where: {
        instrumentId_provider: { instrumentId, provider: MARKET_PROVIDER_NAME },
      },
    });
    const refreshing =
      !!process.env.ALPHA_VANTAGE_API_KEY?.trim() &&
      !!mapping?.currentRequestedAt &&
      !mapping.error;
    if (!mapping)
      return {
        quote: null,
        error:
          missing === "MARKET_NOT_CONFIGURED" ? missing : "MARKET_UNMAPPED",
      };
    if (
      !price ||
      price.provider !== MARKET_PROVIDER_NAME ||
      price.availableAt > new Date()
    )
      return {
        quote: null,
        error: mapping?.error ?? (mapping ? missing : "MARKET_UNMAPPED"),
      };
    if (
      price.currency !== asset.currency ||
      price.provider !== MARKET_PROVIDER_NAME
    )
      return { quote: null, error: "MARKET_IDENTITY_MISMATCH" };
    const stale =
      !!mapping?.error ||
      (price.kind === "QUOTE" &&
        !!price.marketAt &&
        Date.now() - price.marketAt.getTime() > 36 * 3600000) ||
      Date.now() - price.tradingDate.getTime() > 7 * 86400000 ||
      !mapping?.lastSuccessAt ||
      Date.now() - mapping.lastSuccessAt.getTime() > 36 * 3600000;
    return {
      ...(refreshing ? { refreshPending: true } : {}),
      quote: {
        price: price.price.toString(),
        currency: price.currency,
        fetchedAt: price.fetchedAt.toISOString(),
        marketAt: price.marketAt?.toISOString() ?? null,
        tradingDate: price.tradingDate.toISOString().slice(0, 10),
        provider: price.provider,
        delayed: true,
        kind: price.kind,
        stale,
      },
      error: mapping?.error ?? null,
    };
  }
}

export interface MarketPrice {
  kind: "QUOTE" | "CLOSE";
  price: string;
  currency: string;
  fetchedAt: string;
  marketAt: string | null;
  provider: string;
  delayed: boolean;
  stale: boolean;
  tradingDate: string;
}
export type PriceResult = {
  quote: MarketPrice | null;
  error: string | null;
  refreshPending?: boolean;
};

export function marketDataSymbol(asset: Asset) {
  const symbol = (asset.marketDataIdentifier || asset.symbol).trim();
  return asset.assetType === "CRYPTO"
    ? (symbol.includes("/")
        ? symbol
        : `${symbol}/${asset.currency}`
      ).toUpperCase()
    : symbol;
}
