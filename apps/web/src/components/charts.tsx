"use client";
import { useId, useRef, useState, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  DefaultTooltipContent,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  type PieSectorShapeProps,
  type TooltipPayload,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, resolveLocale } from "@opulya/shared";
import type { Analytics } from "@/lib/types";
import { Empty, Money } from "./ui";
import styles from "./charts.module.css";
const colors = [
  "var(--green)",
  "light-dark(#ad8743, #dec17e)",
  "light-dark(#547ba5, #9ec5ed)",
  "light-dark(#9b626c, #e4a1b1)",
  "light-dark(#68836c, #abc998)",
  "light-dark(#7c7392, #bfb0e0)",
  "light-dark(#b66b4b, #efa98a)",
];
const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--line)",
  color: "var(--text)",
  borderRadius: 6,
};
const tooltipItemStyle = { color: "var(--text)" };
const tooltipCursor = { fill: "light-dark(#edf1ef, #303030)" };
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
              <CartesianGrid vertical={false} stroke="var(--line)" />
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
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                formatter={(v) => formatMoney(String(v), currency, locale)}
              />
              <Area
                type="monotone"
                dataKey="balance"
                name={t("common.balance")}
                stroke="var(--green)"
                fill="light-dark(#dbeae4, #234333)"
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <BarChart
              data={chartData}
              margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} stroke="var(--line)" />
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
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                cursor={tooltipCursor}
                formatter={(v) => formatMoney(String(v), currency, locale)}
              />
              <Bar
                dataKey="income"
                name={t("analytics.income")}
                fill="var(--green)"
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expenses"
                name={t("analytics.expenses")}
                fill="light-dark(#c5a565, #dec17e)"
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
  const tooltipId = useId();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [legendId, setLegendId] = useState<string | null>(null);
  const [sliceId, setSliceId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number }>();
  const active = rows.filter((r) => Number(r.amount) > 0);
  const legendIndex = active.findIndex((row) => row.id === legendId);
  const legendRow = active[legendIndex];
  const highlightedId = legendRow?.id ?? sliceId;
  const highlightSlice = (_: unknown, index: number) => {
    setLegendId(null);
    setSliceId(active[index]?.id ?? null);
  };
  if (!active.length) return <Empty title={t("analytics.noActivity")} />;
  return (
    <div className="distribution">
      <div
        className="donut"
        onMouseMove={(event) => {
          const chart = event.currentTarget.getBoundingClientRect();
          const tooltip = tooltipRef.current?.getBoundingClientRect();
          setPointer({
            x: Math.max(
              0,
              Math.min(
                event.clientX - chart.left + 10,
                window.innerWidth -
                  chart.left -
                  (tooltip?.width ?? chart.width) -
                  16,
              ),
            ),
            y: Math.max(
              0,
              Math.min(
                event.clientY - chart.top + 10,
                window.innerHeight - chart.top - (tooltip?.height ?? 80) - 16,
              ),
            ),
          });
        }}
        onMouseLeave={() => {
          setPointer(undefined);
          setSliceId(null);
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart accessibilityLayer={false}>
            <Pie
              data={active.map((r) => ({ ...r, value: Number(r.amount) }))}
              dataKey="value"
              nameKey="label"
              innerRadius="65%"
              outerRadius="90%"
              paddingAngle={2}
              isAnimationActive={false}
              shape={(props: PieSectorShapeProps) => {
                const row = active[props.index];
                const selected = row?.id === highlightedId;
                const color = colors[props.index % colors.length];
                return (
                  <Sector
                    {...props}
                    className={styles.slice}
                    data-active={selected}
                    fill={color}
                    stroke={selected ? color : "var(--surface)"}
                    strokeWidth={selected ? 4 : 1}
                    opacity={highlightedId && !selected ? 0.4 : 1}
                  />
                );
              }}
              onMouseEnter={highlightSlice}
              onMouseMove={highlightSlice}
              onMouseLeave={(_, index) =>
                setSliceId((current) =>
                  current === active[index]?.id ? null : current,
                )
              }
            />
            <Tooltip
              active={legendRow ? true : undefined}
              defaultIndex={legendIndex >= 0 ? legendIndex : undefined}
              position={legendRow ? undefined : pointer}
              animationDuration={180}
              animationEasing="ease-out"
              content={
                <DistributionTooltip
                  tooltipRef={tooltipRef}
                  id={tooltipId}
                  row={legendRow}
                  currency={currency}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend">
        {active.map((r, i) => (
          <li
            key={r.id}
            onMouseEnter={() => setLegendId(r.id)}
            onMouseLeave={() => setLegendId(null)}
            onFocus={() => setLegendId(r.id)}
            onBlur={() => setLegendId(null)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLegendId(null);
            }}
          >
            {onSelect && r.id !== "direct" ? (
              <button
                aria-describedby={legendId === r.id ? tooltipId : undefined}
                onClick={() => {
                  setLegendId(null);
                  onSelect(r.id);
                }}
              >
                <i
                  style={{ background: colors[i % colors.length] }}
                  aria-hidden
                />
                <span>{r.label}</span>
                <Money value={r.amount} currency={currency} />
              </button>
            ) : (
              <div
                tabIndex={0}
                aria-describedby={legendId === r.id ? tooltipId : undefined}
              >
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
function DistributionTooltip({
  active,
  payload = [],
  row,
  currency,
  id,
  tooltipRef,
}: {
  active?: boolean;
  payload?: TooltipPayload;
  row?: { id: string; label: string; amount: string };
  currency: string;
  id: string;
  tooltipRef: RefObject<HTMLDivElement | null>;
}) {
  const locale = resolveLocale(useLocale());
  if (!active) return null;
  return (
    <div ref={tooltipRef} id={id} role="tooltip" className={styles.tooltip}>
      <DefaultTooltipContent
        payload={
          row
            ? [{ graphicalItemId: row.id, name: row.label, value: row.amount }]
            : payload
        }
        contentStyle={{ ...tooltipStyle, whiteSpace: "normal" }}
        itemStyle={tooltipItemStyle}
        formatter={(value) => formatMoney(String(value), currency, locale)}
      />
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
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis
              dataKey="day"
              fontSize={11}
              axisLine={false}
              tickLine={false}
              interval={4}
            />
            <YAxis width={45} fontSize={11} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              itemStyle={tooltipItemStyle}
              cursor={tooltipCursor}
              formatter={(v) => formatMoney(String(v), currency, locale)}
            />
            <Bar
              dataKey="expenses"
              name={t("analytics.expenses")}
              fill="light-dark(#ad8743, #dec17e)"
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
