"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Repeat2, Trash2 } from "lucide-react";
import {
  decimal,
  formatMoney,
  resolveLocale,
  type monthlyInvestmentBudgets,
} from "@opulya/shared";
import { api, queryString } from "@/lib/api";
import { listingExchange } from "@/lib/listing";
import type { Asset } from "@/lib/types";
import { BudgetForm, BudgetRemoval } from "./budget-forms";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  Modal,
  Money,
  Stat,
} from "./ui";
import styles from "./budgets-view.module.css";

type InvestmentBudgetReport = ReturnType<typeof monthlyInvestmentBudgets>;

export function InvestmentBudgetsView({
  month,
  currency,
  tabs,
}: {
  month: string;
  currency: string;
  tabs: ReactNode;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Asset>();
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api<Asset[]>("assets"),
  });
  const query = useQuery({
    queryKey: ["budgets", month, currency, "INVESTMENT"],
    queryFn: () =>
      api<InvestmentBudgetReport>(
        `budgets?${queryString({ month, currency, type: "INVESTMENT" })}`,
      ),
  });
  const report = query.data;
  const byId = new Map(report?.rows.map((row) => [row.assetId, row]));
  const ordered = (assets.data ?? [])
    .filter((asset) => asset.currency === currency)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, locale) ||
        a.symbol.localeCompare(b.symbol, locale),
    );
  const rows = ordered.filter((asset) => byId.get(asset.id)?.amount != null);
  const available = ordered.filter(
    (asset) => byId.get(asset.id)?.amount == null,
  );
  const current = ordered.find((asset) => asset.id === selected);
  const identity = (asset: Asset) =>
    [asset.symbol, listingExchange(asset), asset.currency]
      .filter(Boolean)
      .join(" · ");
  const options = available.map((asset) => ({
    id: asset.id,
    label: `${asset.name} (${identity(asset)})`,
  }));
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));
  function add() {
    if (!available.length) return;
    setAdding(true);
    setSelected(available[0]!.id);
  }
  function close() {
    setSelected(undefined);
    setAdding(false);
  }
  return (
    <>
      <div className={styles.toolbar}>
        {tabs}
        {!!rows.length && (
          <Button
            type="button"
            onClick={add}
            disabled={!available.length || !report}
          >
            <Plus size={17} aria-hidden="true" />
            {t("budgets.addInvestment")}
          </Button>
        )}
      </div>
      <ErrorNotice error={query.error || assets.error} />
      {(query.isLoading || assets.isLoading) && <Loading />}
      {report && assets.data && (
        <>
          <section
            className="stats-row four"
            aria-label={t("budgets.investments")}
          >
            <Stat
              label={t("budgets.planned")}
              value={report.planned}
              currency={currency}
            />
            <Stat
              label={t("budgets.invested")}
              value={report.actual}
              currency={currency}
            />
            <Stat
              label={t("budgets.leftToInvest")}
              value={report.remaining}
              currency={currency}
            />
            <Stat
              label={t("budgets.allPurchases")}
              value={report.totalActual}
              currency={currency}
            />
          </section>
          {rows.length ? (
            <section className="section">
              <div className={styles.head} aria-hidden="true">
                <span>{t("assets.asset")}</span>
                <span>{t("budgets.purchased")}</span>
                <span>{t("budgets.target")}</span>
                <span>{t("budgets.leftToInvest")}</span>
              </div>
              <ul
                className={styles.list}
                aria-label={t("budgets.selectedAssets")}
              >
                {rows.map((asset) => {
                  const row = byId.get(asset.id)!;
                  const reached = decimal(row.remaining!).lte(0);
                  const progress = decimal(row.amount!).isZero()
                    ? decimal(row.actual).gt(0)
                      ? 100
                      : 0
                    : decimal(row.actual)
                        .div(row.amount!)
                        .mul(100)
                        .clamp(0, 100)
                        .toNumber();
                  return (
                    <li
                      key={asset.id}
                      className={styles.row}
                      data-asset-id={asset.id}
                    >
                      <div className={styles.asset}>
                        <strong>{asset.name}</strong>
                        <small>{identity(asset)}</small>
                        <span className={styles.meta}>
                          {row.hasOverride ? (
                            t("budgets.override")
                          ) : (
                            <>
                              <Repeat2 size={12} aria-hidden="true" />
                              {t("budgets.repeated")}
                            </>
                          )}
                        </span>
                      </div>
                      <div className={styles.value}>
                        <span className={styles.mobileLabel}>
                          {t("budgets.purchased")}
                        </span>
                        <Money value={row.actual} currency={currency} />
                      </div>
                      <div className={styles.value}>
                        <span className={styles.mobileLabel}>
                          {t("budgets.target")}
                        </span>
                        <Money value={row.amount} currency={currency} />
                      </div>
                      <div
                        className={`${styles.value} ${reached ? styles.achieved : ""}`}
                      >
                        <span className={styles.mobileLabel}>
                          {t("budgets.leftToInvest")}
                        </span>
                        <Money value={row.remaining} currency={currency} />
                      </div>
                      <div className={styles.actions}>
                        <IconButton
                          label={t("budgets.editNamed", { name: asset.name })}
                          onClick={() => {
                            setAdding(false);
                            setSelected(asset.id);
                          }}
                        >
                          <Pencil size={17} />
                        </IconButton>
                        <IconButton
                          label={t("budgets.removeNamed", { name: asset.name })}
                          onClick={() => setRemoving(asset)}
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </div>
                      <div className={styles.progressLine}>
                        <div
                          className={styles.track}
                          role="progressbar"
                          aria-label={t("budgets.progress", {
                            name: asset.name,
                            actual: formatMoney(row.actual, currency, locale),
                            amount: formatMoney(row.amount!, currency, locale),
                          })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        {reached && (
                          <small className={styles.achieved}>
                            {t("budgets.achieved")}
                          </small>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <Empty
              title={t(
                ordered.length
                  ? "budgets.emptyInvestments"
                  : "budgets.noAssets",
              )}
            >
              {available.length ? (
                <Button type="button" onClick={add}>
                  <Plus size={17} aria-hidden="true" />
                  {t("budgets.addInvestment")}
                </Button>
              ) : (
                <Link className="button secondary" href="/assets">
                  <Plus size={17} aria-hidden="true" />
                  {t("investments.addAsset")}
                </Link>
              )}
            </Empty>
          )}
        </>
      )}
      <Modal
        title={t(adding ? "budgets.addInvestment" : "budgets.editInvestment")}
        open={!!current}
        onClose={close}
        description={
          current
            ? `${adding ? "" : `${current.name} / ${identity(current)} / `}${monthLabel}`
            : undefined
        }
      >
        {current && byId.get(current.id) && (
          <BudgetForm
            key={`${current.id}:${month}:${currency}`}
            target={{ assetId: current.id }}
            row={byId.get(current.id)!}
            month={month}
            currency={currency}
            onDone={close}
            targetOptions={adding ? options : undefined}
            onTargetChange={setSelected}
          />
        )}
      </Modal>
      <Modal
        title={t("budgets.remove")}
        open={!!removing}
        onClose={() => setRemoving(undefined)}
        description={
          removing
            ? `${removing.name} / ${identity(removing)} / ${monthLabel}`
            : undefined
        }
      >
        {removing && (
          <BudgetRemoval
            key={`${removing.id}:${month}:${currency}`}
            target={{ assetId: removing.id }}
            month={month}
            currency={currency}
            onDone={() => setRemoving(undefined)}
          />
        )}
      </Modal>
    </>
  );
}
