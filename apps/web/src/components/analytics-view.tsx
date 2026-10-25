"use client";
import { Dropdown } from "./dropdown";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { formatDate, resolveLocale } from "@opulya/shared";
import { api, queryString } from "@/lib/api";
import type { Account, Analytics, Category, Transaction } from "@/lib/types";
import { DailyChart, DistributionChart, FlowChart } from "./charts";
import { categoryName, categoryPath } from "./forms";
import { Empty, ErrorNotice, Loading, Modal, Money, Stat } from "./ui";
import { TransactionList } from "./transaction-list";
import { useUser } from "./providers";
export function AnalyticsView({
  month,
  currency,
  accounts,
  categories,
}: {
  month: string;
  currency: string;
  accounts: Account[];
  categories: Category[];
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  const user = useUser();
  const [parentId, setParent] = useState("");
  const [type, setType] = useState("EXPENSE");
  const [accountId, setAccount] = useState("");
  const [day, setDay] = useState("");
  const query = queryString({ month, currency, parentId, type, accountId });
  const report = useQuery({
    queryKey: ["analytics", query],
    queryFn: () => api<Analytics>(`analytics?${query}`),
  });
  const dayTransactions = useQuery({
    queryKey: ["transactions", month, currency, accountId],
    queryFn: () =>
      api<Transaction[]>(
        `transactions?${queryString({ month, currency, accountId })}`,
      ),
    enabled: !!day,
  });
  const parent = categories.find((c) => c.id === parentId);
  const a = report.data;
  const orderedAccounts = [...(a?.accounts ?? [])].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  return (
    <>
      <div className="filters">
        <Dropdown
          value={accountId}
          onValueChange={(value) => setAccount(value)}
          aria-label={t("common.account")}
        >
          <option value="">
            {t("common.all")} · {t("nav.accounts")}
          </option>
          {accounts
            .filter((a) => a.currency === currency)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </Dropdown>
      </div>
      <ErrorNotice error={report.error} />
      {report.isLoading ? (
        <Loading />
      ) : (
        a && (
          <>
            <section className="stats-row">
              <Stat
                label={t("analytics.income")}
                value={a.income}
                currency={currency}
                accent="positive"
              />
              <Stat
                label={t("analytics.expenses")}
                value={a.expenses}
                currency={currency}
              />
              <Stat
                label={t("analytics.net")}
                value={a.net}
                currency={currency}
              />
            </section>
            <div className="two-columns">
              <section className="section">
                <h2>{t("analytics.monthly")}</h2>
                <FlowChart data={a.trends} currency={currency} />
              </section>
              <section className="section">
                <h2>{t("analytics.daily")}</h2>
                <DailyChart days={a.days} currency={currency} />
              </section>
            </div>
            <div className="two-columns">
              <section className="section">
                <div className="section-heading">
                  <h2>{t("analytics.distribution")}</h2>
                  <Dropdown
                    value={type}
                    onValueChange={(value) => {
                      setType(value);
                      setParent("");
                    }}
                    aria-label={t("common.type")}
                  >
                    <option value="EXPENSE">{t("types.EXPENSE")}</option>
                    <option value="INCOME">{t("types.INCOME")}</option>
                  </Dropdown>
                </div>
                <div className="category-breadcrumb">
                  <button onClick={() => setParent(parent?.parentId ?? "")}>
                    {parent ? t("common.back") : t("analytics.root")}
                  </button>
                  {parent && <span>{categoryPath(parent, categories, t)}</span>}
                </div>
                <DistributionChart
                  rows={a.distribution
                    .map((c) => ({
                      id: c.id,
                      label: categoryName(c, t),
                      amount: c.amount,
                    }))
                    .concat([
                      {
                        id: "direct",
                        label: t(parent ? "analytics.direct" : "common.direct"),
                        amount: a.direct,
                      },
                    ])}
                  currency={currency}
                  onSelect={setParent}
                />
              </section>
              <section className="section">
                <h2>{t("analytics.calendar")}</h2>
                <div className="calendar-week">
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i}>
                      {new Intl.DateTimeFormat(locale, {
                        weekday: "short",
                        timeZone: "UTC",
                      }).format(new Date(Date.UTC(2026, 8, 28 + i)))}
                    </span>
                  ))}
                </div>
                <div className="calendar">
                  {Array.from(
                    {
                      length:
                        (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7,
                    },
                    (_, i) => (
                      <div key={`blank-${i}`} />
                    ),
                  )}
                  {a.days.map((d) => (
                    <button
                      key={d.date}
                      className={d.count ? "has-activity" : ""}
                      onClick={() => setDay(d.date)}
                      aria-label={`${formatDate(d.date + "T12:00:00Z", locale, "UTC")}: ${t("transactions.count", { count: d.count })}`}
                    >
                      <span>{Number(d.date.slice(-2))}</span>
                      {d.count > 0 && <i aria-hidden />}
                      <small>{d.count || ""}</small>
                    </button>
                  ))}
                </div>
              </section>
            </div>
            <div className="two-columns">
              <section className="section">
                <h2>{t("analytics.account")}</h2>
                {a.accounts.length ? (
                  <div className="data-list">
                    {orderedAccounts.map((account) => (
                      <div key={account.id}>
                        <strong>{account.name}</strong>
                        <span className="account-flow">
                          <span className="positive">
                            {t("analytics.income")}{" "}
                            <Money value={account.income} currency={currency} />
                          </span>
                          <span>
                            {t("analytics.expenses")}{" "}
                            <Money
                              value={account.expenses}
                              currency={currency}
                            />
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty title={t("common.noData")} />
                )}
              </section>
              <section className="section">
                <h2>{t("analytics.trend")}</h2>
                <FlowChart data={a.trends} currency={currency} balance />
              </section>
            </div>
          </>
        )
      )}
      <Modal
        title={
          day
            ? t("analytics.selectedDay", {
                date: formatDate(day + "T12:00:00Z", locale, "UTC"),
              })
            : t("analytics.calendar")
        }
        open={!!day}
        onClose={() => setDay("")}
      >
        <ErrorNotice error={dayTransactions.error} />
        {dayTransactions.isLoading ? (
          <Loading />
        ) : (
          <TransactionList
            transactions={(dayTransactions.data ?? []).filter((tx) => {
              const parts = new Intl.DateTimeFormat("en-CA", {
                timeZone: user.timeZone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
              }).formatToParts(new Date(tx.occurredAt));
              const date = ["year", "month", "day"]
                .map((k) => parts.find((p) => p.type === k)?.value)
                .join("-");
              return date === day;
            })}
            accounts={accounts}
            categories={categories}
            compact
          />
        )}
      </Modal>
    </>
  );
}
