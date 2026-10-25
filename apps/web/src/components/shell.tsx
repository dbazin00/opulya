"use client";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  ChartNoAxesCombined,
  TrendingUp,
  Tags,
  Settings,
  LogOut,
  Menu,
  Plus,
  Library,
  ChartPie,
} from "lucide-react";
import { api } from "@/lib/api";
import { useUser } from "./providers";
import { ErrorNotice, IconButton, Modal } from "./ui";
import { TransactionForm } from "./forms";
import { BrandLink } from "./brand-link";
import { ThemeToggle } from "./theme-toggle";
const links = [
  ["dashboard", LayoutDashboard],
  ["accounts", Wallet],
  ["transactions", ArrowLeftRight],
  ["analytics", ChartNoAxesCombined],
  ["budgets", ChartPie],
  ["investments", TrendingUp],
  ["assets", Library],
  ["categories", Tags],
  ["settings", Settings],
] as const;
export function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const path = usePathname();
  const user = useUser();
  const shell = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLElement>(null);
  const mobileNavigation = useRef<HTMLElement>(null);
  const [more, setMore] = useState(false);
  const [add, setAdd] = useState(false);
  const [error, setError] = useState<unknown>();
  useLayoutEffect(() => {
    const root = shell.current;
    const topbar = header.current;
    const navigation = mobileNavigation.current;
    if (!root || !topbar || !navigation) return;
    const measure = () => {
      const bounds = topbar.getBoundingClientRect();
      const menu = navigation.getBoundingClientRect();
      root.style.setProperty(
        "--loading-top",
        `${Math.max(0, bounds.bottom)}px`,
      );
      root.style.setProperty("--loading-left", `${Math.max(0, bounds.left)}px`);
      root.style.setProperty(
        "--loading-bottom",
        `${menu.height ? Math.max(0, window.innerHeight - menu.top) : 0}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(topbar);
    observer.observe(navigation);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, []);
  const nav = (mobile = false) =>
    links
      .filter((_, i) => !mobile || i < 4)
      .map(([name, Icon]) => (
        <Link
          href={`/${name}`}
          key={name}
          className={path.startsWith(`/${name}`) ? "active" : ""}
          aria-current={path.startsWith(`/${name}`) ? "page" : undefined}
          onClick={() => setMore(false)}
        >
          <Icon size={19} aria-hidden />
          <span>{t(`nav.${name}`)}</span>
        </Link>
      ));
  return (
    <div className="app-shell" ref={shell}>
      <a className="skip-link" href="#main-content">
        {t("common.skip")}
      </a>
      <aside className="sidebar">
        <BrandLink href="/dashboard" className="brand-lockup" />
        <nav aria-label={t("common.navigation")}>{nav()}</nav>
        <div className="sidebar-bottom">
          <span className="avatar">
            {user.firstName.slice(0, 1)}
            {user.lastName.slice(0, 1)}
          </span>
          <div>
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <span>{user.email}</span>
          </div>
          <IconButton
            label={t("nav.logout")}
            onClick={async () => {
              try {
                await api("auth/logout", {});
                window.location.assign("/login");
              } catch (e) {
                setError(e);
              }
            }}
          >
            <LogOut size={18} />
          </IconButton>
        </div>
        <ErrorNotice error={error} />
      </aside>
      <div className="main-column">
        <header className="topbar" ref={header}>
          <BrandLink className="mobile-brand" href="/dashboard" />
          <div className="desktop-breadcrumb">
            {t.has(`nav.${path.split("/")[1]}`)
              ? t(`nav.${path.split("/")[1]}`)
              : t("brand")}
          </div>
          <div className="topbar-actions">
            <ThemeToggle />
            <span className="user-greeting">
              {t("dashboard.greeting", { name: user.firstName })}
            </span>
            <button
              className="button"
              aria-label={t("transactions.add")}
              title={t("transactions.add")}
              disabled={!!user.processingRestrictedAt}
              onClick={() => setAdd(true)}
            >
              <Plus size={18} aria-hidden="true" />
              <span>{t("transactions.add")}</span>
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav
        className="mobile-nav"
        ref={mobileNavigation}
        aria-label={t("common.navigation")}
      >
        {nav(true)}
        <button
          onClick={() => setMore(true)}
          className={
            links.slice(4).some(([name]) => path.startsWith(`/${name}`))
              ? "active"
              : ""
          }
        >
          <Menu size={19} />
          <span>{t("nav.more")}</span>
        </button>
      </nav>
      <Modal title={t("nav.more")} open={more} onClose={() => setMore(false)}>
        <nav className="more-nav">{nav()}</nav>
        <button
          className="button secondary full"
          onClick={async () => {
            try {
              await api("auth/logout", {});
              window.location.assign("/login");
            } catch (e) {
              setError(e);
            }
          }}
        >
          <LogOut size={17} />
          {t("nav.logout")}
        </button>
        <ErrorNotice error={error} />
      </Modal>
      <Modal
        title={t("transactions.add")}
        open={add}
        onClose={() => setAdd(false)}
      >
        {add && <TransactionForm onDone={() => setAdd(false)} />}
      </Modal>
    </div>
  );
}
