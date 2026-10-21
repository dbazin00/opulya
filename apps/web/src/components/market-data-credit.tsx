"use client";
import { useTranslations } from "next-intl";

export function MarketDataCredit() {
  const t = useTranslations("marketData");
  return (
    <p className="market-data-credit">
      {t.rich("credit", {
        provider: (name) => (
          <a
            href="https://finance.yahoo.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            {name}
          </a>
        ),
      })}
    </p>
  );
}
