"use client";
import { Dropdown } from "./dropdown";
import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Undo2 } from "lucide-react";
import {
  formatDate,
  formatTime,
  formatQuantity,
  resolveLocale,
} from "@opulya/shared";
import { api } from "@/lib/api";
import { priceRefreshInterval } from "@/lib/price-refresh";
import type {
  Account,
  EditableInvestment,
  History,
  Portfolio,
} from "@/lib/types";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  Modal,
  Money,
  MonthPicker,
  Stat,
  Spinner,
} from "./ui";
import { InvestmentForm } from "./forms";
import { InstrumentPicker } from "./instrument-picker";
import { MarketDataCredit } from "./market-data-credit";
import { useMonth } from "./workspace";
import { useUser } from "./providers";
export function InvestmentView({
  accounts,
  embedded = false,
}: {
  accounts: Account[];
  embedded?: boolean;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const user = useUser();
  const [chosen, setChosen] = useState("");
  const account = accounts.find((a) => a.id === chosen) ?? accounts[0];
  const [add, setAdd] = useState(false);
  const [asset, setAsset] = useState(false);
  const [month, setMonth] = useMonth();
  const [voidId, setVoid] = useState("");
  const [editing, setEditing] = useState<EditableInvestment>();
  const client = useQueryClient();
  const loadedAccounts = useRef(new Set<string>());
  const pendingSince = useRef(new Map<string, number>());
  const value = useQuery({
    queryKey: ["portfolio", account?.id],
    queryFn: () => {
      const id = account!.id;
      const background = loadedAccounts.current.has(id);
      loadedAccounts.current.add(id);
      return api<Portfolio>(`accounts/${id}/portfolio`, undefined, "POST", {
        background,
      });
    },
    enabled: !!account,
    refetchInterval: (query) =>
      query.state.data
        ? query.state.error
          ? 60000
          : priceRefreshInterval(query.state.data.quotes, pendingSince.current)
        : false,
    retry: false,
    refetchIntervalInBackground: false,
  });
  const activity = useQuery({
    queryKey: ["history", account?.id, month],
    queryFn: () =>
      api<History>(`accounts/${account!.id}/history?month=${month}`),
    enabled: !!account && !embedded,
  });
  const remove = useMutation({
    mutationFn: () => api(`investments/${voidId}/void`, {}),
    onSuccess: async () => {
      await client.invalidateQueries();
      setVoid("");
    },
  });
  if (!account)
    return (
      <Empty title={t("investments.noAccounts")}>
        <Link href="/accounts" className="button">
          <Plus size={17} />
          {t("accounts.add")}
        </Link>
      </Empty>
    );
  const p = value.data;
  const fetchingPrice = p?.quotes.some(
    (item) => !item.quote && item.error === "MARKET_PRICE_PENDING",
  );
  return (
    <>
      <div className="investment-toolbar">
        <Dropdown
          value={account.id}
          onValueChange={(value) => {
            loadedAccounts.current.delete(value);
            setChosen(value);
          }}
          aria-label={t("investments.selectAccount")}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} ({a.currency})
            </option>
          ))}
        </Dropdown>
        <div className="toolbar">
          <Button className="secondary" onClick={() => setAsset(true)}>
            <Plus size={17} />
            {t("investments.addAsset")}
          </Button>
          <Button onClick={() => setAdd(true)} disabled={!!account.archivedAt}>
            <Plus size={17} />
            {t("investments.add")}
          </Button>
        </div>
      </div>
      <ErrorNotice error={value.error} />
      {value.isLoading ? (
        <Loading />
      ) : (
        p && (
          <>
            <section className="stats-row investment-stats">
              <Stat
                label={t("investments.cash")}
                value={p.cashBalance}
                currency={account.currency}
              />
              <Stat
                label={t("investments.value")}
                value={p.holdingsValue}
                placeholder={
                  fetchingPrice ? t("investments.fetchingPrice") : undefined
                }
                currency={account.currency}
              />
              <Stat
                label={t("investments.total")}
                value={p.totalValue}
                placeholder={
                  fetchingPrice ? t("investments.fetchingPrice") : undefined
                }
                currency={account.currency}
              />
            </section>
            {Number(p.cashBalance) < 0 && (
              <p className="notice">{t("investments.negativeCash")}</p>
            )}
            <p className="valuation-note muted">
              {t("investments.dailyClose")}
            </p>
            <section className="section">
              <h2>{t("investments.holdings")}</h2>
              {p.positions.length ? (
                <div className="holdings">
                  {p.positions.map((position) => {
                    const instrument = p.assets.find(
                      (a) => a.id === position.assetId,
                    )!;
                    const quote = p.quotes.find(
                      (q) => q.assetId === position.assetId,
                    );
                    const pending =
                      !quote?.quote && quote?.error === "MARKET_PRICE_PENDING";
                    return (
                      <article className="holding" key={position.assetId}>
                        <div className="holding-title">
                          <div>
                            <strong>{instrument.symbol}</strong>
                            <span>
                              {instrument.name} ·{" "}
                              {instrument.assetType === "CRYPTO"
                                ? t("types.CRYPTO")
                                : instrument.exchange}
                            </span>
                          </div>
                          <Money
                            value={position.marketValue}
                            placeholder={
                              pending
                                ? t("investments.fetchingPrice")
                                : undefined
                            }
                            currency={account.currency}
                          />
                        </div>
                        <dl className="holding-metrics">
                          <div>
                            <dt>{t("investments.quantity")}</dt>
                            <dd>{formatQuantity(position.quantity, locale)}</dd>
                          </div>
                          <div>
                            <dt>{t("investments.average")}</dt>
                            <dd>
                              <Money
                                value={position.averageCost}
                                currency={account.currency}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>{t("investments.price")}</dt>
                            <dd>
                              <Money
                                value={position.currentPrice}
                                maximumFractionDigits={8}
                                placeholder={
                                  pending
                                    ? t("investments.fetchingPrice")
                                    : undefined
                                }
                                currency={account.currency}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>{t("investments.gain")}</dt>
                            <dd
                              className={
                                position.unrealizedGain === null
                                  ? "muted"
                                  : Number(position.unrealizedGain) < 0
                                    ? "negative"
                                    : "positive"
                              }
                            >
                              <Money
                                value={position.unrealizedGain}
                                placeholder={
                                  pending
                                    ? t("investments.fetchingPrice")
                                    : undefined
                                }
                                currency={account.currency}
                              />
                              {position.returnPercent != null && (
                                <small>
                                  {new Intl.NumberFormat(locale, {
                                    style: "percent",
                                    maximumFractionDigits: 2,
                                  }).format(
                                    Number(position.returnPercent) / 100,
                                  )}
                                </small>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>{t("investments.realized")}</dt>
                            <dd>
                              <Money
                                value={position.realizedGain}
                                currency={account.currency}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>{t("investments.totalInvested")}</dt>
                            <dd>
                              <Money
                                value={position.totalInvested}
                                currency={account.currency}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>{t("investments.costBasis")}</dt>
                            <dd>
                              <Money
                                value={position.costBasis}
                                currency={account.currency}
                              />
                            </dd>
                          </div>
                        </dl>
                        <div className="price-status">
                          {quote?.quote ? (
                            <span
                              className={
                                quote.quote.stale ? "negative" : "muted"
                              }
                            >
                              {quote.quote.stale &&
                                `${t("investments.stale")} · `}
                              {t("assets.priceDate")}:{" "}
                              {new Intl.DateTimeFormat(locale, {
                                dateStyle: "medium",
                                timeZone: "UTC",
                              }).format(
                                new Date(
                                  `${quote.quote.tradingDate}T00:00:00Z`,
                                ),
                              )}
                            </span>
                          ) : pending ? (
                            <Spinner
                              label={t("investments.fetchingPrice")}
                              size={16}
                              showLabel
                              className="pending-price"
                            />
                          ) : (
                            <span>
                              {quote?.error && t.has(`errors.${quote.error}`)
                                ? t(`errors.${quote.error}`)
                                : t("investments.unavailable")}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <Empty title={t("investments.noHoldings")} />
              )}
              {!!p.positions.length && <MarketDataCredit />}
            </section>
            <section className="stats-row">
              <Stat
                label={t("investments.realized")}
                value={p.realizedGain}
                currency={account.currency}
              />
              <Stat
                label={t("investments.fees")}
                value={p.totalFees}
                currency={account.currency}
              />
              <Stat
                label={t("investments.dividends")}
                value={p.dividends}
                currency={account.currency}
                accent="positive"
              />
            </section>
          </>
        )
      )}
      {!embedded && (
        <section className="section">
          <div className="section-heading">
            <h2>{t("investments.activity")}</h2>
            <MonthPicker value={month} onChange={setMonth} />
          </div>
          <ErrorNotice error={activity.error} />
          {activity.isLoading ? (
            <Loading />
          ) : (
            <div className="history-list investment-history">
              {activity.data?.entries
                .filter((e) => e.kind === "INVESTMENT")
                .map((entry) => (
                  <article className="history-row" key={entry.id}>
                    <div>
                      <strong>{t(`types.${entry.type}`)}</strong>
                      {entry.funding && (
                        <span>
                          {entry.funding.sourceAccountName} →{" "}
                          {entry.funding.destinationAccountName}
                        </span>
                      )}
                      <time dateTime={entry.timestamp}>
                        {formatDate(entry.timestamp, locale, user.timeZone)} ·{" "}
                        {formatTime(entry.timestamp, locale, user.timeZone)}
                      </time>
                    </div>
                    <div>
                      <Money
                        value={entry.funding?.amount ?? entry.delta}
                        currency={account.currency}
                        className={`transaction-amount ${(entry.funding ? "TRANSFER" : entry.type).toLowerCase()}`}
                      />
                      <small className="history-balance">
                        <span className="sr-only">{t("accounts.after")} </span>
                        <Money
                          value={entry.balanceAfter}
                          currency={account.currency}
                        />
                      </small>
                    </div>
                    <div className="row-actions">
                      {"executedAt" in entry.transaction && (
                        <IconButton
                          label={t("investments.correct")}
                          disabled={!!account.archivedAt}
                          onClick={() => {
                            if ("executedAt" in entry.transaction)
                              setEditing({
                                ...entry.transaction,
                                sourceAccountId:
                                  entry.funding?.sourceAccountId ?? null,
                              });
                          }}
                        >
                          <Pencil size={16} />
                        </IconButton>
                      )}
                      <IconButton
                        label={t("investments.void")}
                        onClick={() => {
                          remove.reset();
                          setVoid(entry.id);
                        }}
                      >
                        <Undo2 size={16} />
                      </IconButton>
                    </div>
                  </article>
                ))}
              {!activity.data?.entries.some((e) => e.kind === "INVESTMENT") && (
                <Empty title={t("accounts.noHistory")} />
              )}
            </div>
          )}
        </section>
      )}
      <Modal
        title={t("investments.add")}
        open={add}
        onClose={() => setAdd(false)}
      >
        {add && (
          <InvestmentForm account={account} onDone={() => setAdd(false)} />
        )}
      </Modal>
      <Modal
        title={t("investments.correct")}
        open={!!editing}
        onClose={() => setEditing(undefined)}
      >
        {editing && (
          <InvestmentForm
            account={account}
            existing={editing}
            onDone={() => setEditing(undefined)}
          />
        )}
      </Modal>
      <Modal
        title={t("investments.addAsset")}
        open={asset}
        onClose={() => setAsset(false)}
      >
        {asset && (
          <InstrumentPicker
            onDone={() => setAsset(false)}
            currency={account.currency}
          />
        )}
      </Modal>
      <Modal
        title={t("investments.voidTitle")}
        description={t(
          activity.data?.entries.find((entry) => entry.id === voidId)?.funding
            ? "investments.voidFundingBody"
            : "investments.voidBody",
        )}
        open={!!voidId}
        onClose={() => setVoid("")}
      >
        <ErrorNotice error={remove.error} />
        <div className="form-footer">
          <Button className="secondary" onClick={() => setVoid("")}>
            {t("common.cancel")}
          </Button>
          <Button
            className="danger"
            busy={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
