"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Repeat2,
  RotateCcw,
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
import { categoryName, categoryPath } from "./forms";
import { Dropdown } from "./dropdown";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Modal,
  Money,
  Stat,
} from "./ui";
import styles from "./budgets-view.module.css";

type BudgetReport = ReturnType<typeof monthlyBudgets>;
type BudgetRow = BudgetReport["rows"][number];

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
  const locale = resolveLocale(useLocale());
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string>();
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
  const visible = categories
    .filter((c) => c.type === type)
    .filter(
      (c) =>
        !c.archivedAt ||
        byId.get(c.id)?.amount != null ||
        decimal(byId.get(c.id)?.actual ?? "0").gt(0),
    )
    .sort(
      (a, b) =>
        collator.compare(categoryName(a, t), categoryName(b, t)) ||
        a.id.localeCompare(b.id),
    );
  const rows = categoryTree(visible, collapsed);
  const current = categories.find((c) => c.id === selected);
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
      <div
        className={`segmented ${styles.tabs}`}
        role="group"
        aria-label={t("common.type")}
      >
        {(["EXPENSE", "INCOME"] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={type === value}
            className={type === value ? "selected" : ""}
            onClick={() => {
              setType(value);
              setSelected(undefined);
            }}
          >
            {t(value === "EXPENSE" ? "budgets.expenses" : "budgets.income")}
          </button>
        ))}
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
                aria-label={t("categories.allCategories")}
              >
                {rows.map(({ category, depth, childCount }) => {
                  const row = byId.get(category.id);
                  if (!row) return null;
                  const name = categoryName(category, t);
                  const configured = row.amount !== null;
                  const over = configured && decimal(row.remaining!).lt(0);
                  const reached = configured && decimal(row.remaining!).lte(0);
                  const progress = !configured
                    ? 0
                    : decimal(row.amount!).isZero()
                      ? decimal(row.actual).gt(0)
                        ? 100
                        : 0
                      : decimal(row.actual)
                          .div(row.amount!)
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
                          <strong>{name}</strong>
                          <span className={styles.meta}>
                            {category.archivedAt ? (
                              t("budgets.archived")
                            ) : row.hasOverride ? (
                              t(
                                row.amount === null
                                  ? "budgets.paused"
                                  : "budgets.override",
                              )
                            ) : configured ? (
                              <>
                                <Repeat2 size={12} aria-hidden="true" />
                                {t("budgets.repeated")}
                              </>
                            ) : (
                              t("budgets.unset")
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
                        {configured ? (
                          <Money value={row.amount} currency={currency} />
                        ) : (
                          <span className="muted">{t("budgets.unset")}</span>
                        )}
                      </div>
                      <div
                        className={`${styles.value} ${over && type === "EXPENSE" ? styles.over : ""}`}
                      >
                        <span className={styles.mobileLabel}>
                          {remainingLabel}
                        </span>
                        {configured ? (
                          <Money value={row.remaining} currency={currency} />
                        ) : (
                          <span aria-hidden="true">-</span>
                        )}
                      </div>
                      <IconButton
                        className={styles.action}
                        label={t("budgets.editNamed", { name })}
                        disabled={
                          !!category.archivedAt &&
                          !configured &&
                          !row.hasOverride
                        }
                        onClick={() => setSelected(category.id)}
                      >
                        {configured || row.hasOverride ? (
                          <Pencil size={17} />
                        ) : (
                          <Plus size={17} />
                        )}
                      </IconButton>
                      {configured && (
                        <div className={styles.progressLine}>
                          <div
                            className={`${styles.track} ${over && type === "EXPENSE" ? styles.over : ""}`}
                            role="progressbar"
                            aria-label={t("budgets.progress", {
                              name,
                              actual: formatMoney(row.actual, currency, locale),
                              amount: formatMoney(
                                row.amount!,
                                currency,
                                locale,
                              ),
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
                                type === "EXPENSE"
                                  ? styles.over
                                  : styles.achieved
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
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : (
            <Empty title={t("budgets.empty")}>
              <Link className="button secondary" href="/categories">
                <Plus size={17} />
                {t("budgets.addCategory")}
              </Link>
            </Empty>
          )}
        </>
      )}
      <Modal
        title={t("budgets.edit")}
        open={!!current}
        onClose={() => setSelected(undefined)}
        description={
          current
            ? `${categoryPath(current, categories, t)} / ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`))}`
            : undefined
        }
      >
        {current && byId.get(current.id) && (
          <BudgetForm
            key={`${current.id}:${month}:${currency}`}
            category={current}
            row={byId.get(current.id)!}
            month={month}
            currency={currency}
            onDone={() => setSelected(undefined)}
          />
        )}
      </Modal>
    </>
  );
}

function BudgetForm({
  category,
  row,
  month,
  currency,
  onDone,
}: {
  category: Category;
  row: BudgetRow;
  month: string;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations();
  const client = useQueryClient();
  const [scope, setScope] = useState<"MONTH" | "RECURRING">(
    row.hasOverride ? "MONTH" : "RECURRING",
  );
  const [amount, setAmount] = useState(row.amount ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useMutation({
    mutationFn: (action: "save" | "remove" | "reset") =>
      api(
        action === "reset" ? "budgets/override" : "budgets",
        {
          categoryId: category.id,
          month,
          currency,
          ...(action === "reset"
            ? {}
            : { scope, amount: action === "remove" ? null : amount }),
        },
        action === "reset" ? "DELETE" : "POST",
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["budgets"] });
      await client.invalidateQueries({ queryKey: ["categories"] });
      onDone();
    },
  });
  return (
    <form
      className="entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate("save");
      }}
    >
      <Field label={t("budgets.scope")}>
        {(id) => (
          <Dropdown
            id={id}
            value={scope}
            onValueChange={(v) => {
              setScope(v as "MONTH" | "RECURRING");
              setConfirmRemove(false);
            }}
          >
            <option value="MONTH">{t("budgets.monthOnly")}</option>
            <option value="RECURRING">{t("budgets.recurring")}</option>
          </Dropdown>
        )}
      </Field>
      <Field label={`${t("budgets.amount")} (${currency})`}>
        {(id) => (
          <input
            id={id}
            type="number"
            inputMode="decimal"
            required
            min="0"
            step="0.01"
            max="999999999999999.99"
            value={amount}
            disabled={!!category.archivedAt || save.isPending || confirmRemove}
            onChange={(e) => setAmount(e.target.value)}
          />
        )}
      </Field>
      <ErrorNotice error={save.error} />
      {confirmRemove && (
        <p role="status">
          {t(
            scope === "MONTH" ? "budgets.removeConfirm" : "budgets.stopConfirm",
          )}
        </p>
      )}
      {row.hasOverride && (
        <Button
          type="button"
          className="secondary"
          busy={save.isPending}
          onClick={() => save.mutate("reset")}
        >
          <RotateCcw size={17} />
          {t(
            row.recurringAmount === null
              ? "budgets.resetNone"
              : "budgets.reset",
          )}
        </Button>
      )}
      <div className="form-footer">
        {row.amount !== null && (
          <Button
            type="button"
            className={confirmRemove ? "danger" : "secondary"}
            busy={save.isPending}
            onClick={() =>
              confirmRemove ? save.mutate("remove") : setConfirmRemove(true)
            }
          >
            <Trash2 size={17} />
            {t(
              confirmRemove
                ? "common.confirm"
                : scope === "MONTH"
                  ? "budgets.remove"
                  : "budgets.stop",
            )}
          </Button>
        )}
        {confirmRemove ? (
          <Button
            type="button"
            className="secondary"
            disabled={save.isPending}
            onClick={() => setConfirmRemove(false)}
          >
            {t("common.cancel")}
          </Button>
        ) : (
          <Button
            type="submit"
            busy={save.isPending}
            disabled={!!category.archivedAt}
          >
            {t("common.save")}
          </Button>
        )}
      </div>
    </form>
  );
}
