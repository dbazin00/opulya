"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  Landmark,
  Menu,
  ShieldCheck,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { formatMoney, resolveLocale } from "@opulya/shared";
import { LanguageSelect } from "./language-select";
import { BrandLink } from "./brand-link";
import { LegalLinks } from "./legal-links";
import styles from "./landing-page.module.css";

const views = ["overview", "transactions", "investments"] as const;
type View = (typeof views)[number];

function ProductPreview() {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const [view, setView] = useState<View>("overview");
  const id = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const money = (value: string) => formatMoney(value, "EUR", locale);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % views.length
        : event.key === "ArrowLeft"
          ? (index + views.length - 1) % views.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? views.length - 1
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setView(views[next]!);
    tabs.current[next]?.focus();
  }
  return (
    <section
      id="overview"
      className={styles.preview}
      aria-label={t("landing.preview")}
    >
      <div className={styles.previewBar}>
        <div
          role="tablist"
          aria-label={t("landing.demoTabs")}
          className={styles.previewTabs}
        >
          <span
            aria-hidden="true"
            className={styles.previewIndicator}
            style={{ transform: `translateX(${views.indexOf(view) * 100}%)` }}
          />
          {views.map((item, index) => (
            <button
              key={item}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${id}-${item}`}
              aria-controls={`${id}-panel`}
              aria-selected={view === item}
              tabIndex={view === item ? 0 : -1}
              onClick={() => setView(item)}
              onKeyDown={(event) => navigate(event, index)}
            >
              {t(`landing.${item}Tab`)}
            </button>
          ))}
        </div>
        <span className={styles.example}>
          <span aria-hidden="true" />
          {t("landing.example")}
        </span>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${view}`}
        tabIndex={0}
        className={styles.previewPanel}
      >
        <div key={view} className={styles.previewContent}>
          {view === "overview" ? (
            <>
              <div className={styles.previewWealth}>
                <div>
                  <span>{t("dashboard.netWorth")}</span>
                  <strong>{money("24580.40")}</strong>
                  <small>
                    {t("dashboard.selectedCurrency", { currency: "EUR" })}
                  </small>
                </div>
                <dl>
                  <div>
                    <dt>{t("dashboard.cash")}</dt>
                    <dd>{money("16230.40")}</dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.investments")}</dt>
                    <dd>{money("8350")}</dd>
                  </div>
                </dl>
              </div>
              <div className={styles.previewAccounts}>
                {(
                  [
                    ["demoAccounts", "4280.40", Landmark],
                    ["demoSavings", "11950", Wallet],
                    ["demoPortfolio", "8350", TrendingUp],
                  ] as const
                ).map(([name, value, Icon]) => (
                  <div key={name}>
                    <Icon size={20} aria-hidden="true" />
                    <span>{t(`landing.${name}`)}</span>
                    <strong>{money(value)}</strong>
                  </div>
                ))}
              </div>
            </>
          ) : view === "transactions" ? (
            <>
              <div className={styles.previewHeading}>
                <h2>{t("dashboard.recent")}</h2>
                <span>
                  {new Intl.DateTimeFormat(locale, {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  }).format(new Date("2026-09-01T12:00:00Z"))}
                </span>
              </div>
              <ul className={styles.previewTransactions}>
                {(
                  [
                    ["demoSalary", "2800", "4280.40", ArrowDownLeft, "income"],
                    ["demoFood", "-62.50", "1480.40", ArrowUpRight, "expense"],
                    [
                      "demoTransfer",
                      "250",
                      "1542.90",
                      ArrowLeftRight,
                      "transfer",
                    ],
                  ] as const
                ).map(([name, amount, balance, Icon, type]) => (
                  <li key={name}>
                    <Icon aria-hidden="true" size={20} />
                    <div>
                      <strong>{t(`landing.${name}`)}</strong>
                      <span>
                        {t(
                          type === "transfer"
                            ? "types.TRANSFER"
                            : "landing.demoAccounts",
                        )}
                      </span>
                    </div>
                    <div>
                      <strong className={`transaction-amount ${type}`}>
                        {money(amount)}
                      </strong>
                      <span>{money(balance)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className={styles.previewHeading}>
                <h2>{t("landing.demoAsset")}</h2>
                <span>{t("landing.demoQuantity")}</span>
              </div>
              <p className={styles.holdingDescription}>
                {t("landing.demoHolding")}
              </p>
              <dl className={styles.holdingStats}>
                {(
                  [
                    ["demoCost", "8000"],
                    ["demoValue", "8350"],
                    ["demoGain", "350"],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{t(`landing.${label}`)}</dt>
                    <dd
                      className={label === "demoGain" ? "positive" : undefined}
                    >
                      {money(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className={styles.priceNote}>{t("landing.demoPriceNote")}</p>
            </>
          )}
        </div>
      </div>
      <p className={styles.previewCaption}>{t("landing.exampleNote")}</p>
    </section>
  );
}

export function LandingPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [menu, setMenu] = useState(false);
  const navigationId = useId();
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menu) navigation.current?.querySelector("a")?.focus();
  }, [menu]);
  const sections = [
    ["overview", "overview"],
    ["getting-started", "howItWorks"],
    ["questions", "questions"],
  ] as const;
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#main-content">
        {t("common.skip")}
      </a>
      <header
        className={styles.header}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menu) {
            setMenu(false);
            menuButton.current?.focus();
          }
        }}
      >
        <BrandLink href="/" className={styles.brand} />
        <nav
          ref={navigation}
          id={navigationId}
          aria-label={t("common.navigation")}
          className={`${styles.navigation} ${menu ? styles.navigationOpen : ""}`}
        >
          {sections.map(([id, key]) => (
            <a key={id} href={`#${id}`} onClick={() => setMenu(false)}>
              {t(`landing.${key}`)}
            </a>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <LanguageSelect
            value={locale}
            label={t("common.language")}
            onValueChange={(next) => {
              document.cookie = `OPULYA_LOCALE=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
              window.location.reload();
            }}
          />
          <Link href="/login" className={`button ${styles.login}`}>
            {t("auth.signIn")}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <button
            ref={menuButton}
            type="button"
            className={`icon-button ${styles.menuButton}`}
            aria-label={t(menu ? "landing.closeMenu" : "landing.openMenu")}
            aria-expanded={menu}
            aria-controls={navigationId}
            onClick={() => setMenu(!menu)}
          >
            {menu ? (
              <X size={22} aria-hidden="true" />
            ) : (
              <Menu size={22} aria-hidden="true" />
            )}
          </button>
        </div>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="landing-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>{t("landing.introduction")}</p>
            <h1 id="landing-title">{t("brand")}</h1>
            <p className={styles.tagline}>{t("tagline")}</p>
            <p className={styles.description}>{t("landing.description")}</p>
            <a href="#overview" className={styles.explore}>
              {t("landing.explore")}
              <ArrowDown size={16} aria-hidden="true" />
            </a>
            <p className={styles.heroNote}>
              <Check size={14} aria-hidden="true" />
              {t("landing.heroNote")}
            </p>
          </div>
          <ProductPreview />
        </section>
        <section className={styles.features} aria-labelledby="features-title">
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{t("landing.overview")}</p>
            <h2 id="features-title">{t("landing.featuresTitle")}</h2>
            <p>{t("landing.featuresBody")}</p>
          </div>
          <div className={styles.featureGrid}>
            {(
              [
                ["accounts", Wallet],
                ["spending", ChartNoAxesCombined],
                ["investments", TrendingUp],
              ] as const
            ).map(([key, Icon], index) => (
              <article key={key}>
                <span className={styles.featureIndex}>
                  <Icon size={23} aria-hidden="true" />
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </span>
                <h3>{t(`landing.${key}Title`)}</h3>
                <p>{t(`landing.${key}Body`)}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          id="getting-started"
          className={styles.steps}
          aria-labelledby="steps-title"
        >
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{t("landing.howItWorks")}</p>
            <h2 id="steps-title">{t("landing.stepsTitle")}</h2>
            <p>{t("landing.stepsBody")}</p>
          </div>
          <ol>
            {(["One", "Two", "Three"] as const).map((step, index) => (
              <li key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{t(`landing.step${step}`)}</h3>
                  <p>{t(`landing.step${step}Body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className={styles.privacyBand} aria-labelledby="privacy-title">
          <ShieldCheck size={34} aria-hidden="true" />
          <div>
            <h2 id="privacy-title">{t("landing.privacyTitle")}</h2>
            <p>{t("landing.privacyBody")}</p>
            <small>{t("landing.privacyNote")}</small>
          </div>
        </section>
        <section
          id="questions"
          className={styles.faq}
          aria-labelledby="faq-title"
        >
          <div className={styles.sectionIntro}>
            <p className={styles.eyebrow}>{t("landing.questions")}</p>
            <h2 id="faq-title">{t("landing.faqTitle")}</h2>
          </div>
          <div>
            {(["Bank", "Prices", "Categories", "Mobile"] as const).map(
              (key) => (
                <details key={key}>
                  <summary>
                    {t(`landing.faq${key}`)}
                    <ChevronDown size={19} aria-hidden="true" />
                  </summary>
                  <p>{t(`landing.faq${key}Body`)}</p>
                </details>
              ),
            )}
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link href="/" className={styles.brand}>
          {t("brand")}
        </Link>
        <p>{t("landing.disclaimer")}</p>
        <LegalLinks />
      </footer>
    </div>
  );
}
