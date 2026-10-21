"use client";
import { useLocale, useTranslations } from "next-intl";
import { resolveLocale } from "@opulya/shared";
import type { Portfolio } from "@/lib/types";
import { useUser } from "./providers";
import { Spinner } from "./ui";

export function QuoteStatus({
  quote,
  error,
  loading = false,
  showTimeLabel = true,
}: Pick<Portfolio["quotes"][number], "quote" | "error"> & {
  loading?: boolean;
  showTimeLabel?: boolean;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const user = useUser();
  const timestamp = quote?.marketAt || quote?.fetchedAt;
  const date = timestamp
    ? new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: user.timeZone,
      }).format(new Date(timestamp))
    : null;
  return (
    <div className="price-status" aria-live="polite">
      {quote && date && (
        <>
          <time dateTime={timestamp!}>
            {showTimeLabel
              ? t(
                  quote.marketAt
                    ? "investments.priceAsOf"
                    : "investments.retrievedAt",
                  { date },
                )
              : date}
          </time>
          {["CLOSED", "PRE", "POST", "PREPRE", "POSTPOST"].includes(
            quote.marketState ?? "",
          ) && <span>{t("investments.marketClosed")}</span>}
          {(quote.delayMinutes ?? 0) > 0 ? (
            <span>
              {t("investments.delayMinutes", { minutes: quote.delayMinutes! })}
            </span>
          ) : (
            quote.delayed && <span>{t("investments.delayed")}</span>
          )}
          {quote.stale && (
            <span className="negative">{t("investments.stale")}</span>
          )}
        </>
      )}
      {loading && !quote ? (
        <Spinner label={t("investments.fetchingPrice")} size={16} showLabel />
      ) : error ? (
        <span className="negative">
          {t.has(`errors.${error}`)
            ? t(`errors.${error}`)
            : t("errors.MARKET_UNAVAILABLE")}
        </span>
      ) : (
        !quote && <span className="muted">{t("investments.unavailable")}</span>
      )}
    </div>
  );
}
