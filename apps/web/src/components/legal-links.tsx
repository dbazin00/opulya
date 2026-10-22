"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

export function LegalLinks() {
  const t = useTranslations("legal");
  return (
    <nav className="legal-links" aria-label={t("navigation")}>
      <Link href="/privacy">{t("privacy.title")}</Link>
      <Link href="/security">{t("security.title")}</Link>
      <Link href="/terms">{t("terms.title")}</Link>
    </nav>
  );
}
