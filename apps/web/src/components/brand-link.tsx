"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

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
      <Image src="/opulya-mark.png" alt="" width={48} height={48} preload />
      <span>{t("brand")}</span>
    </Link>
  );
}
