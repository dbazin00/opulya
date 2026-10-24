"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Repeat2,
  Trash2,
} from "lucide-react";
import {
  categoryTree,
  decimal,
  formatMoney,
  resolveLocale,
  type monthlyBudgets,
} from "@opulya/shared";
import { api, queryString } from "@/lib/api";
import type { Category } from "@/lib/types";
import { budgetCategories } from "@/lib/budget-categories";
import { categoryName, categoryPath } from "./forms";
import { BudgetForm, BudgetRemoval } from "./budget-forms";
import { InvestmentBudgetsView } from "./investment-budgets-view";
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

type BudgetReport = ReturnType<typeof monthlyBudgets>;

export function BudgetsView({
  month,
  currency,
  categories,
}: {
  month: string;
  currency: string;
  categories: Category[];
}) {
  const t = useTranslations();
  const [type, setType] = useState<"EXPENSE" | "INCOME" | "INVESTMENT">(
    "EXPENSE",
  );
  const tabs = (
    <div
      className={`segmented ${styles.tabs}`}
      role="group"
      aria-label={t("common.type")}
    >
      {(["EXPENSE", "INCOME", "INVESTMENT"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={type === value}
          className={type === value ? "selected" : ""}
          onClick={() => setType(value)}
        >
          {t(
            value === "EXPENSE"
              ? "budgets.expenses"
              : value === "INCOME"
                ? "budgets.income"
                : "budgets.investments",
          )}
        </button>
      ))}
    </div>
  );
  return type === "INVESTMENT" ? (
    <InvestmentBudgetsView month={month} currency={currency} tabs={tabs} />
  ) : (
    <CategoryBudgetsView
      key={type}
      month={month}
      currency={currency}
      categories={categories}
      type={type}
      tabs={tabs}
    />
  );
}

function CategoryBudgetsView({
  month,
  currency,
  categories,
  type,
  tabs,
}: {
  month: string;
  currency: string;
  categories: Category[];
  type: "EXPENSE" | "INCOME";
  tabs: ReactNode;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Category>();
  const query = useQuery({
    queryKey: ["budgets", month, currency, type],
    queryFn: () =>
      api<BudgetReport>(`budgets?${queryString({ month, currency, type })}`),
  });
  const report = query.data;
  const byId = new Map(report?.rows.map((r) => [r.categoryId, r]));
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  const ordered = categories
    .filter((c) => c.type === type)
    .sort(
      (a, b) =>
        collator.compare(categoryName(a, t), categoryName(b, t)) ||
        a.id.localeCompare(b.id),
    );
  const chosen = budgetCategories(ordered, report?.rows ?? []);
  const chosenIds = new Set(chosen.map((c) => c.id));
  const rows = categoryTree(chosen, collapsed);
  const available = ordered
    .filter((c) => !c.archivedAt && !chosenIds.has(c.id))
    .map((c) => ({ id: c.id, label: categoryPath(c, categories, t) }))
    .sort((a, b) => collator.compare(a.label, b.label));
  const originals = new Map(categories.map((c) => [c.id, c]));
  const current = categories.find((c) => c.id === selected);
  function closeEditor() {
    setSelected(undefined);
    setAdding(false);
  }
  function addBudget() {
    if (!available.length) return;
    setAdding(true);
    setSelected(available[0]!.id);
  }
  function finishEditing() {
    if (adding && current) {
      setCollapsed((previous) => {
        const next = new Set(previous);
        const visited = new Set([current.id]);
        let parent = current.parentId;
        while (parent && !visited.has(parent)) {
          visited.add(parent);
          next.delete(parent);
          parent = originals.get(parent)?.parentId ?? null;
        }
        return next;
      });
    }
    closeEditor();
  }
  const actualLabel = t(
    type === "EXPENSE" ? "budgets.actual" : "budgets.actualIncome",
  );
  const amountLabel = t(
    type === "EXPENSE" ? "budgets.limit" : "budgets.target",
  );
  const remainingLabel = t(
    type === "EXPENSE" ? "budgets.remaining" : "budgets.outstanding",
  );
  return (
    <>
      <div className={styles.toolbar}>
        {tabs}
        {!!rows.length && (
          <Button
            type="button"
            disabled={!available.length || !report}
            onClick={addBudget}
          >
            <Plus size={17} aria-hidden="true" />
            {t("budgets.add")}
          </Button>
        )}
      </div>
      <ErrorNotice error={query.error} />
      {query.isLoading && <Loading />}
      {report && (
        <>
          <section className="stats-row four" aria-label={t("budgets.title")}>
            <Stat
              label={t("budgets.planned")}
              value={report.planned}
              currency={currency}
            />
            <Stat
              label={t(
                type === "EXPENSE" ? "budgets.tracked" : "budgets.received",
              )}
              value={report.actual}
              currency={currency}
            />
            <Stat
              label={remainingLabel}
              value={report.remaining}
              currency={currency}
            />
            <Stat
              label={t(
                type === "EXPENSE"
                  ? "budgets.allSpending"
                  : "budgets.allIncome",
              )}
              value={report.totalActual}
              currency={currency}
            />
          </section>
          {rows.length ? (
            <section className="section">
              <div className={styles.head} aria-hidden="true">
                <span>{t("budgets.category")}</span>
                <span>{actualLabel}</span>
                <span>{amountLabel}</span>
                <span>{remainingLabel}</span>
              </div>
              <ul
                className={styles.list}
                aria-label={t("budgets.selectedCategories")}
              >
                {rows.map(({ category, depth, childCount }) => {
                  const row = byId.get(category.id);
                  if (!row || row.amount === null) return null;
                  const name = categoryName(category, t);
                  const original = originals.get(category.id)!;
                  const label =
                    original.parentId === category.parentId
                      ? name
                      : categoryPath(original, categories, t);
                  const over = decimal(row.remaining!).lt(0);
                  const reached = decimal(row.remaining!).lte(0);
                  const progress = decimal(row.amount).isZero()
                    ? decimal(row.actual).gt(0)
                      ? 100
                      : 0
                    : decimal(row.actual)
                        .div(row.amount)
                        .mul(100)
                        .clamp(0, 100)
                        .toNumber();
                  const expanded = !collapsed.has(category.id);
                  return (
                    <li
                      key={category.id}
                      className={styles.row}
                      data-category-id={category.id}
                    >
                      <div
                        className={styles.category}
                        style={{
                          paddingInlineStart: Math.min(depth, 4) * 16,
                        }}
                      >
                        {!!childCount && (
                          <IconButton
                            label={t(
                              expanded
                                ? "categories.collapse"
                                : "categories.expand",
                              { name },
                            )}
                            aria-expanded={expanded}
                            onClick={() =>
                              setCollapsed((old) => {
                                const next = new Set(old);
                                if (next.has(category.id))
                                  next.delete(category.id);
                                else next.add(category.id);
                                return next;
                              })
                            }
                          >
                            {expanded ? (
                              <ChevronDown size={17} />
                            ) : (
                              <ChevronRight size={17} />
                            )}
                          </IconButton>
                        )}
                        <div className={styles.name}>
                          <strong>{label}</strong>
                          <span className={styles.meta}>
                            {category.archivedAt ? (
                              t("budgets.archived")
                            ) : row.hasOverride ? (
                              t("budgets.override")
                            ) : (
                              <>
                                <Repeat2 size={12} aria-hidden="true" />
                                {t("budgets.repeated")}
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className={styles.value}>
                        <span className={styles.mobileLabel}>
                          {actualLabel}
                        </span>
                        <Money value={row.actual} currency={currency} />
                      </div>
                      <div className={styles.value}>
                        <span className={styles.mobileLabel}>
                          {amountLabel}
                        </span>
                        <Money value={row.amount} currency={currency} />
                      </div>
                      <div
                        className={`${styles.value} ${over && type === "EXPENSE" ? styles.over : ""}`}
                      >
                        <span className={styles.mobileLabel}>
                          {remainingLabel}
                        </span>
                        <Money value={row.remaining} currency={currency} />
                      </div>
                      <div className={styles.actions}>
                        <IconButton
                          label={t("budgets.editNamed", {
                            name: categoryPath(original, categories, t),
                          })}
                          onClick={() => {
                            setAdding(false);
                            setSelected(category.id);
                          }}
                        >
                          <Pencil size={17} />
                        </IconButton>
                        <IconButton
                          label={t("budgets.removeNamed", {
                            name: categoryPath(original, categories, t),
                          })}
                          onClick={() => setRemoving(original)}
                        >
                          <Trash2 size={17} />
                        </IconButton>
                      </div>
                      <div className={styles.progressLine}>
                        <div
                          className={`${styles.track} ${over && type === "EXPENSE" ? styles.over : ""}`}
                          role="progressbar"
                          aria-label={t("budgets.progress", {
                            name,
                            actual: formatMoney(row.actual, currency, locale),
                            amount: formatMoney(row.amount, currency, locale),
                          })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                        >
                          <span style={{ width: `${progress}%` }} />
                        </div>
                        {((type === "EXPENSE" && over) ||
                          (type === "INCOME" && reached)) && (
                          <small
                            className={
                              type === "EXPENSE" ? styles.over : styles.achieved
                            }
                          >
                            {t(
                              type === "EXPENSE"
                                ? "budgets.over"
                                : "budgets.achieved",
                            )}
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
                available.length ? "budgets.emptyMonth" : "budgets.empty",
              )}
            >
              {available.length ? (
                <Button type="button" onClick={addBudget}>
                  <Plus size={17} aria-hidden="true" />
                  {t("budgets.add")}
                </Button>
              ) : (
                <Link className="button secondary" href="/categories">
                  <Plus size={17} />
                  {t("budgets.addCategory")}
                </Link>
              )}
            </Empty>
          )}
        </>
      )}
      <Modal
        title={t(adding ? "budgets.add" : "budgets.edit")}
        open={!!current}
        onClose={closeEditor}
        description={
          current
            ? `${adding ? "" : `${categoryPath(current, categories, t)} / `}${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`))}`
            : undefined
        }
      >
        {current && byId.get(current.id) && (
          <BudgetForm
            key={`${current.id}:${month}:${currency}`}
            target={{ categoryId: current.id }}
            archived={!!current.archivedAt}
            row={byId.get(current.id)!}
            month={month}
            currency={currency}
            onDone={finishEditing}
            targetOptions={adding ? available : undefined}
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
            ? `${categoryPath(removing, categories, t)} / ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`))} / ${currency}`
            : undefined
        }
      >
        {removing && (
          <BudgetRemoval
            key={`${removing.id}:${month}:${currency}`}
            target={{ categoryId: removing.id }}
            month={month}
            currency={currency}
            onDone={() => setRemoving(undefined)}
          />
        )}
      </Modal>
    </>
  );
}
