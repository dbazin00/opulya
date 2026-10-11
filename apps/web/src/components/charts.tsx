"use client";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, resolveLocale } from "@opulya/shared";
import type { Analytics } from "@/lib/types";
import { Empty, Money } from "./ui";
const colors = [
  "#075c49",
  "#ad8743",
  "#547ba5",
  "#9b626c",
  "#68836c",
  "#7c7392",
  "#b66b4b",
];
export function FlowChart({
  data,
  currency,
  balance = false,
}: {
  data: Analytics["trends"];
  currency: string;
  balance?: boolean;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const chartData = data.map((row) => ({
    ...row,
    label: new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${row.month}-01T12:00:00Z`)),
    income: Number(row.income),
    expenses: Number(row.expenses),
    balance: Number(row.balance),
  }));
  return (
    <>
      <div
        className="chart"
        role="img"
        aria-label={t(balance ? "analytics.trend" : "analytics.monthly")}
      >
        <ResponsiveContainer width="100%" height="100%">
          {balance ? (
            <AreaChart
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#e7ebe9" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                fontSize={12}
              />
              <YAxis
                width={52}
                axisLine={false}
                tickLine={false}
                fontSize={11}
                tickFormatter={(v) =>
                  new Intl.NumberFormat(locale, { notation: "compact" }).format(
                    v,
                  )
                }
              />
              <Tooltip
                formatter={(v) => formatMoney(String(v), currency, locale)}
              />
              <Area
                type="monotone"
                dataKey="balance"
                name={t("common.balance")}
                stroke="#075c49"
                fill="#dbeae4"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="#e7ebe9" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                fontSize={12}
              />
              <YAxis
                width={52}
                axisLine={false}
                tickLine={false}
                fontSize={11}
                tickFormatter={(v) =>
                  new Intl.NumberFormat(locale, { notation: "compact" }).format(
                    v,
                  )
                }
              />
              <Tooltip
                formatter={(v) => formatMoney(String(v), currency, locale)}
              />
              <Bar
                dataKey="income"
                name={t("analytics.income")}
                fill="#075c49"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expenses"
                name={t("analytics.expenses")}
                fill="#c5a565"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>{t("common.show")}</summary>
        <div className="data-list">
          {data.map((row) => (
            <div key={row.month}>
              <strong>{row.month}</strong>
              {balance ? (
                <Money value={row.balance} currency={currency} />
              ) : (
                <span>
                  {t("analytics.income")}{" "}
                  <Money value={row.income} currency={currency} /> ·{" "}
                  {t("analytics.expenses")}{" "}
                  <Money value={row.expenses} currency={currency} />
                </span>
              )}
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
export function DistributionChart({
  rows,
  currency,
  onSelect,
}: {
  rows: { id: string; label: string; amount: string }[];
  currency: string;
  onSelect?: (id: string) => void;
}) {
  const t = useTranslations();
  const active = rows.filter((r) => Number(r.amount) > 0);
  if (!active.length) return <Empty title={t("analytics.noActivity")} />;
  return (
    <div className="distribution">
      <div className="donut" aria-hidden inert>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={active.map((r) => ({ ...r, value: Number(r.amount) }))}
              dataKey="value"
              nameKey="label"
              innerRadius="65%"
              outerRadius="90%"
              paddingAngle={2}
              isAnimationActive={false}
            >
              {active.map((r, i) => (
                <Cell key={r.id} fill={colors[i % colors.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        {active.map((r, i) => (
          <li key={r.id}>
            {onSelect && r.id !== "direct" ? (
              <button onClick={() => onSelect(r.id)}>
                <i
                  style={{ background: colors[i % colors.length] }}
                  aria-hidden
                />
                <span>{r.label}</span>
                <Money value={r.amount} currency={currency} />
              </button>
            ) : (
              <div>
                <i
                  style={{ background: colors[i % colors.length] }}
                  aria-hidden
                />
                <span>{r.label}</span>
                <Money value={r.amount} currency={currency} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function DailyChart({
  days,
  currency,
}: {
  days: Analytics["days"];
  currency: string;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  return (
    <>
      <div
        className="chart compact-chart"
        role="img"
        aria-label={t("analytics.daily")}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={days.map((d) => ({
              day: d.date.slice(-2),
              expenses: Number(d.expenses),
            }))}
          >
            <CartesianGrid vertical={false} stroke="#e7ebe9" />
            <XAxis
              dataKey="day"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis width={45} fontSize={11} axisLine={false} tickLine={false} />
            <Tooltip
              formatter={(v) => formatMoney(String(v), currency, locale)}
            />
            <Bar
              dataKey="expenses"
              name={t("analytics.expenses")}
              fill="#ad8743"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="chart-data">
        <summary>{t("common.show")}</summary>
        <div className="data-list">
          {days.map((d) => (
            <div key={d.date}>
              <span>{d.date}</span>
              <Money value={d.expenses} currency={currency} />
            </div>
          ))}
        </div>
      </details>
    </>
  );
}
