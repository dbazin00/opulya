"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LanguageSelect } from "./language-select";
import { BrandLink } from "./brand-link";
import { BrandMark } from "./brand-mark";
import { LegalLinks } from "./legal-links";
import { ThemeToggle } from "./theme-toggle";

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
        <div className="auth-actions">
          <ThemeToggle />
          <LanguageSelect
            label={t("common.language")}
            value={locale}
            onValueChange={(next) => {
              document.cookie = `OPULYA_LOCALE=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
              onBeforeLocaleChange?.();
              window.location.reload();
            }}
          />
        </div>
      </header>
      <main className="auth-body">
        <aside className="auth-story" aria-label={t("brand")}>
          <BrandMark size={144} />
          <p>{t("auth.contextTitle")}</p>
          <span aria-hidden="true" />
          <small>{t("tagline")}</small>
        </aside>
        {children}
      </main>
      <footer className="auth-footer">
        <span>{t("tagline")}</span>
        <LegalLinks />
      </footer>
    </div>
  );
}
