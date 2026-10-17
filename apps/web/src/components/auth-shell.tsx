"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSelect } from "./language-select";
import { BrandLink } from "./brand-link";

export function AuthShell({
  children,
  onBeforeLocaleChange,
}: {
  children: ReactNode;
  onBeforeLocaleChange?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <div className="auth-page">
      <header className="auth-top">
        <BrandLink className="auth-brand" href="/" />
        <LanguageSelect
          label={t("common.language")}
          value={locale}
          onValueChange={(next) => {
            document.cookie = `OPULYA_LOCALE=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
            onBeforeLocaleChange?.();
            window.location.reload();
          }}
        />
      </header>
      <main className="auth-body">
        <aside className="auth-story" aria-label={t("brand")}>
          <Image src="/opulya-mark.png" alt="" width={144} height={144} />
          <p>{t("auth.contextTitle")}</p>
          <span aria-hidden="true" />
          <small>{t("tagline")}</small>
        </aside>
        {children}
      </main>
      <footer className="auth-footer">{t("tagline")}</footer>
    </div>
  );
}
