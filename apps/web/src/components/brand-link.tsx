"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { BrandMark } from "./brand-mark";

export function BrandLink({
  href,
  className = "",
}: {
  href: string;
  className?: string;
}) {
  const t = useTranslations();
  return (
    <Link
      href={href}
      className={`brand-link ${className}`}
      aria-label={t("brand")}
    >
      <BrandMark size={48} preload />
      <span>{t("brand")}</span>
    </Link>
  );
}
