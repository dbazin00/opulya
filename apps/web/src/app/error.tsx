"use client";
import { useTranslations } from "next-intl";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return (
    <main className="error-page">
      <h1>{t("errors.NETWORK_ERROR")}</h1>
      <button className="button" onClick={reset}>
        {t("common.retry")}
      </button>
    </main>
  );
}
