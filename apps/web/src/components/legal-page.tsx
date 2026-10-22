"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { termsVersion } from "@opulya/shared";
import type { LegalDetails } from "@/lib/legal-config";
import { BrandLink } from "./brand-link";
import { LanguageSelect } from "./language-select";
import { LegalLinks } from "./legal-links";

const sections = {
  privacy: [
    "controller",
    "data",
    "purposes",
    "providers",
    "transfers",
    "retention",
    "storage",
    "rights",
    "choices",
    "changes",
  ],
  security: ["controls", "access", "limits", "reporting"],
  terms: ["service", "account", "records", "prices", "availability", "rights"],
} as const;

export function LegalPage({
  policy,
  details,
}: {
  policy: keyof typeof sections;
  details: LegalDetails;
}) {
  const t = useTranslations("legal");
  const common = useTranslations();
  const locale = useLocale();
  return (
    <div className="legal-page">
      <a className="skip-link" href="#legal-content">
        {common("common.skip")}
      </a>
      <header className="auth-top">
        <BrandLink href="/" />
        <LanguageSelect
          label={common("common.language")}
          value={locale}
          onValueChange={(next) => {
            document.cookie = `OPULYA_LOCALE=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
            window.location.reload();
          }}
        />
      </header>
      <main id="legal-content" className="legal-content">
        <Link href="/signup" className="legal-back">
          <ArrowLeft size={16} aria-hidden />
          {t("back")}
        </Link>
        <h1>{t(`${policy}.title`)}</h1>
        {policy === "terms" && (
          <p>{t("termsVersion", { version: termsVersion })}</p>
        )}
        <p className="muted">
          {t("updated", {
            date: new Intl.DateTimeFormat(locale, {
              dateStyle: "long",
              timeZone: "UTC",
            }).format(new Date("2026-10-22T12:00:00Z")),
          })}
        </p>
        {details.draft && (
          <aside className="legal-draft" role="note">
            <strong>{t("draftTitle")}</strong>
            <p>{t("draftBody")}</p>
          </aside>
        )}
        <p>{t(`${policy}.intro`)}</p>
        {sections[policy].map((section) => (
          <section key={section} aria-labelledby={`legal-${section}`}>
            <h2 id={`legal-${section}`}>
              {t(`${policy}.sections.${section}.title`)}
            </h2>
            <p>{t(`${policy}.sections.${section}.body`)}</p>
            {section === "controller" && (
              <dl className="legal-contact">
                <dt>{t("operator")}</dt>
                <dd>{details.operator || t("notConfigured")}</dd>
                <dt>{t("contact")}</dt>
                <dd>
                  {details.email ? (
                    <a href={`mailto:${details.email}`}>{details.email}</a>
                  ) : (
                    t("notConfigured")
                  )}
                </dd>
              </dl>
            )}
            {section === "retention" && (
              <p className="legal-deployment">
                {details.retention || t("retentionPending")}
              </p>
            )}
            {section === "transfers" && (
              <p className="legal-deployment">
                {details.transfers || t("transfersPending")}
              </p>
            )}
            {section === "rights" && policy === "privacy" && (
              <p>
                <a
                  href="https://azop.hr/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("authority")}
                </a>
              </p>
            )}
            {(section === "reporting" ||
              (section === "rights" && policy === "privacy")) &&
              details.email && (
                <p>
                  <a href={`mailto:${details.email}`}>{t("contactAction")}</a>
                </p>
              )}
          </section>
        ))}
        <p className="legal-review">{t("review")}</p>
      </main>
      <footer className="auth-footer">
        <LegalLinks />
      </footer>
    </div>
  );
}
