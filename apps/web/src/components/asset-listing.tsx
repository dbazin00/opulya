"use client";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { listingExchange } from "@/lib/listing";
import type { Asset, Instrument } from "@/lib/types";

type Listing = Asset | Instrument;

export function AssetListing({ listing }: { listing: Listing }) {
  const t = useTranslations();
  const exchange = listingExchange(listing);
  return (
    <span className="listing-identity">
      <strong>{listing.name}</strong>
      <span>
        {t(`types.${listing.assetType}`)}
        {exchange ? ` · ${exchange}` : ""}
      </span>
      <span className="listing-currency">
        {t("listing.tradesIn", { currency: listing.currency })}
      </span>
      <small>{listing.symbol}</small>
    </span>
  );
}

export function ListingDetails({ listing }: { listing: Listing }) {
  const t = useTranslations("listing");
  const sourceSymbol =
    "sourceSymbol" in listing ? listing.sourceSymbol : listing.symbol;
  const yahooSymbol =
    listing.assetType === "CRYPTO"
      ? (sourceSymbol || listing.symbol).replace(/\/([A-Z]{3})$/, "-$1")
      : sourceSymbol || listing.symbol;
  return (
    <details className="listing-details">
      <summary>
        {t("details")}
        <ChevronDown size={14} aria-hidden />
      </summary>
      <dl>
        <div>
          <dt>{t("yahooSymbol")}</dt>
          <dd>{yahooSymbol}</dd>
        </div>
        {listing.assetType !== "CRYPTO" && listing.exchange && (
          <div>
            <dt>{t("exchangeCode")}</dt>
            <dd>{listing.exchange}</dd>
          </div>
        )}
        {listing.mic && (
          <div>
            <dt>{t("mic")}</dt>
            <dd>{listing.mic}</dd>
          </div>
        )}
        {listing.isin && (
          <div>
            <dt>{t("isin")}</dt>
            <dd>{listing.isin}</dd>
          </div>
        )}
      </dl>
    </details>
  );
}
