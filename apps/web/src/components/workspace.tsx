"use client";
import { Dropdown } from "./dropdown";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Scale,
  Plus,
  Wallet,
  TrendingUp,
  Pencil,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  accountTypes,
  ledgerTypes,
  formatDate,
  formatTime,
  priceRefreshInterval,
  resolveLocale,
} from "@opulya/shared";
import { api, queryString } from "@/lib/api";
import { useVisible } from "@/lib/use-visible";
import type {
  Account,
  Analytics,
  Category,
  EditableInvestment,
  History,
  Overview,
  Transaction,
} from "@/lib/types";
import { useCurrencies, useUser } from "./providers";
import { MarketDataCredit } from "./market-data-credit";
import {
  Button,
  Empty,
  ErrorNotice,
  Field,
  IconButton,
  Loading,
  Modal,
  Money,
  MonthPicker,
  Stat,
} from "./ui";
import {
  AccountForm,
  BalanceAdjustmentForm,
  categoryName,
  categoryPath,
  InvestmentForm,
  TransactionForm,
} from "./forms";
import { FlowChart, DistributionChart } from "./charts";
import { TransactionList } from "./transaction-list";
import { AnalyticsView } from "./analytics-view";
import { InvestmentView } from "./investment-view";
import { SettingsView } from "./settings-view";
import { CategoriesView } from "./categories-view";
import { AssetsView } from "./assets-view";
import { BudgetsView } from "./budgets-view";
import transactionStyles from "./transaction-layout.module.css";

export function useMonth() {
  const user = useUser();
  return useState(() => {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: user.timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());
    return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
  });
}
export function Workspace({
  view,
  accountId,
  privacyContact,
}: {
  view: string;
  accountId?: string;
  privacyContact?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const currencies = useCurrencies();
  const [currency, setCurrency] = useState("EUR");
  const [month, setMonth] = useMonth();
  const [addAccount, setAddAccount] = useState(false);
  const [addTransaction, setAddTransaction] = useState(false);
  const user = useUser();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("accounts"),
    enabled: !user.processingRestrictedAt && view !== "settings",
  });
  const collator = new Intl.Collator(locale, {
    sensitivity: "base",
    numeric: true,
  });
  const orderedAccounts = [...(accounts.data ?? [])].sort((a, b) =>
    collator.compare(a.name, b.name),
  );
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("categories"),
    enabled: !user.processingRestrictedAt && view !== "settings",
  });
  const showMonth =
    ["transactions", "analytics", "budgets"].includes(view) || !!accountId;
  if (user.processingRestrictedAt && view !== "settings")
    return (
      <div className="workspace">
        <h1>{t("privacySettings.restrictedTitle")}</h1>
        <p>{t("privacySettings.restrictedDescription")}</p>
        <Link className="button" href="/settings">
          {t("settings.title")}
        </Link>
      </div>
    );
  return (
    <div className="workspace">
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            {view === "dashboard" ? t("dashboard.thisMonth") : t("brand")}
          </p>
          <h1>{t(`${view === "dashboard" ? "dashboard" : view}.title`)}</h1>
          <p className="subtitle">{t(`${view}.subtitle`)}</p>
        </div>
        <div
          className={`page-actions${view === "transactions" ? ` ${transactionStyles.actions}` : ""}`}
        >
          {showMonth && <MonthPicker value={month} onChange={setMonth} />}
          {["dashboard", "analytics", "transactions", "budgets"].includes(
            view,
          ) && (
            <Dropdown
              className="currency-select"
              value={currency}
              aria-label={t("common.currency")}
              onValueChange={(value) => setCurrency(value)}
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Dropdown>
          )}
          {view === "accounts" && !accountId && (
            <Button onClick={() => setAddAccount(true)}>
              <Plus size={18} />
              {t("accounts.add")}
            </Button>
          )}
          {view === "transactions" && (
            <Button onClick={() => setAddTransaction(true)}>
              <Plus size={18} />
              {t("transactions.add")}
            </Button>
          )}
        </div>
      </div>
      <ErrorNotice error={accounts.error || categories.error} />
      {view === "dashboard" && (
        <Dashboard
          month={month}
          currency={currency}
          accounts={orderedAccounts}
          categories={categories.data ?? []}
          onAddAccount={() => setAddAccount(true)}
        />
      )}
      {view === "accounts" &&
        (accountId ? (
          <AccountHistory
            accountId={accountId}
            month={month}
            accounts={orderedAccounts}
            categories={categories.data ?? []}
          />
        ) : accounts.isLoading ? (
          <Loading />
        ) : (
          <AccountsView
            accounts={orderedAccounts}
            onAdd={() => setAddAccount(true)}
          />
        ))}
      {view === "transactions" && (
        <TransactionsView
          month={month}
          currency={currency}
          accounts={orderedAccounts}
          categories={categories.data ?? []}
        />
      )}
      {view === "categories" && (
        <CategoriesView categories={categories.data ?? []} />
      )}
      {view === "budgets" &&
        (categories.isLoading ? (
          <Loading />
        ) : (
          <BudgetsView
            month={month}
            currency={currency}
            categories={categories.data ?? []}
          />
        ))}
      {view === "analytics" && (
        <AnalyticsView
          month={month}
          currency={currency}
          accounts={orderedAccounts}
          categories={categories.data ?? []}
        />
      )}
      {view === "investments" && (
        <InvestmentView
          accounts={orderedAccounts.filter((a) => a.type === "INVESTMENT")}
        />
      )}
      {view === "settings" && <SettingsView privacyContact={privacyContact} />}
      {view === "assets" && <AssetsView />}
      <Modal
        title={t("accounts.add")}
        open={addAccount}
        onClose={() => setAddAccount(false)}
      >
        {addAccount && <AccountForm onDone={() => setAddAccount(false)} />}
      </Modal>
      <Modal
        title={t("transactions.add")}
        open={addTransaction}
        onClose={() => setAddTransaction(false)}
      >
        {addTransaction && (
          <TransactionForm onDone={() => setAddTransaction(false)} />
        )}
      </Modal>
    </div>
  );
}
function AccountTile({ account }: { account: Account }) {
  const t = useTranslations();
  const Icon =
    account.type === "BANK"
      ? Building2
      : account.type === "CASH"
        ? Wallet
        : TrendingUp;
  return (
    <Link href={`/accounts/${account.id}`} className="account-tile">
      <div className="account-top">
        <span className={`account-icon ${account.type.toLowerCase()}`}>
          <Icon size={20} />
        </span>
        <ArrowUpRight size={17} />
      </div>
      <h3>{account.name}</h3>
      <p>
        {t(`types.${account.type}`)}
        {account.archivedAt ? ` · ${t("common.archived")}` : ""}
      </p>
      <Money value={account.currentBalance} currency={account.currency} />
      <small>
        {t(
          account.type === "INVESTMENT" ? "investments.cash" : "common.balance",
        )}
      </small>
    </Link>
  );
}
function Dashboard({
  month,
  currency,
  accounts,
  categories,
  onAddAccount,
}: {
  month: string;
  currency: string;
  accounts: Account[];
  categories: Category[];
  onAddAccount: () => void;
}) {
  const t = useTranslations();
  const visible = useVisible();
  const loaded = useRef(new Set<string>());
  const overview = useQuery({
    queryKey: ["overview", currency],
    queryFn: () => {
      const background = loaded.current.has(currency);
      loaded.current.add(currency);
      return api<Overview>(`overview?currency=${currency}`, undefined, "POST", {
        background,
      });
    },
    enabled: visible,
    refetchInterval: accounts.some(
      (account) =>
        account.type === "INVESTMENT" && account.currency === currency,
    )
      ? priceRefreshInterval(visible, true)
      : false,
    refetchIntervalInBackground: false,
  });
  const analytics = useQuery({
    queryKey: ["analytics", month, currency],
    queryFn: () =>
      api<Analytics>(`analytics?month=${month}&currency=${currency}`),
  });
  const transactions = useQuery({
    queryKey: ["transactions", month, currency],
    queryFn: () =>
      api<Transaction[]>(`transactions?month=${month}&currency=${currency}`),
  });
  if (overview.isLoading || analytics.isLoading) return <Loading />;
  const a = analytics.data,
    o = overview.data;
  return (
    <>
      <ErrorNotice
        error={overview.error || analytics.error || transactions.error}
      />
      <section className="wealth-band">
        <div className="wealth-primary">
          <span>{t("dashboard.netWorth")}</span>
          <Money value={o?.netWorth} currency={currency} />
          <small>{t("dashboard.selectedCurrency", { currency })}</small>
        </div>
        <div className="wealth-secondary">
          <Stat
            label={t("dashboard.cash")}
            value={o?.cash}
            currency={currency}
          />
          <Stat
            label={t("dashboard.investments")}
            value={o?.investments}
            currency={currency}
          />
        </div>
      </section>
      {o?.incomplete && (
        <p className="notice">{t("dashboard.valuationMissing")}</p>
      )}
      {o?.stale && <p className="notice">{t("dashboard.stale")}</p>}
      {o?.investments != null && Number(o.investments) > 0 && (
        <MarketDataCredit />
      )}
      <section className="stats-row">
        <Stat
          label={t("dashboard.income")}
          value={a?.income}
          currency={currency}
          accent="positive"
        />
        <Stat
          label={t("dashboard.expenses")}
          value={a?.expenses}
          currency={currency}
        />
        <Stat
          label={t("dashboard.cashflow")}
          value={a?.net}
          currency={currency}
        />
      </section>
      <section className="section">
        <div className="section-heading">
          <h2>{t("dashboard.accountOverview")}</h2>
          <Link href="/accounts">
            {t("common.viewAll")}
            <ArrowRight size={15} />
          </Link>
        </div>
        {accounts.length ? (
          <div className="account-grid">
            {accounts
              .filter((a) => !a.archivedAt && a.currency === currency)
              .slice(0, 4)
              .map((a) => (
                <AccountTile key={a.id} account={a} />
              ))}
          </div>
        ) : (
          <Empty
            title={t("dashboard.noAccounts")}
            description={t("dashboard.noAccountsBody")}
          >
            <Button onClick={onAddAccount}>
              <Plus size={17} />
              {t("accounts.add")}
            </Button>
          </Empty>
        )}
      </section>
      <div className="two-columns">
        <section className="section">
          <div className="section-heading">
            <h2>{t("dashboard.incomeChart")}</h2>
            <div className="inline-legend">
              <span>
                <i className="green-dot" />
                {t("analytics.income")}
              </span>
              <span>
                <i className="gold-dot" />
                {t("analytics.expenses")}
              </span>
            </div>
          </div>
          {a && <FlowChart data={a.trends} currency={currency} />}
        </section>
        <section className="section">
          <div className="section-heading">
            <h2>{t("dashboard.spending")}</h2>
            <Link href="/analytics">
              <ArrowUpRight size={18} aria-label={t("nav.analytics")} />
            </Link>
          </div>
          {a && (
            <DistributionChart
              rows={a.distribution
                .map((c) => ({
                  id: c.id,
                  label: categoryName(c, t),
                  amount: c.amount,
                }))
                .concat([
                  { id: "direct", label: t("common.direct"), amount: a.direct },
                ])}
              currency={currency}
            />
          )}
        </section>
      </div>
      <div className="two-columns">
        <section className="section">
          <div className="section-heading">
            <h2>{t("dashboard.recent")}</h2>
            <Link href="/transactions">
              {t("common.viewAll")}
              <ArrowRight size={15} />
            </Link>
          </div>
          <TransactionList
            transactions={(transactions.data ?? []).slice(0, 5)}
            accounts={accounts}
            categories={categories}
            compact
          />
        </section>
        <section className="section">
          <div className="section-heading">
            <h2>{t("dashboard.cashTrend")}</h2>
          </div>
          {a && <FlowChart data={a.trends} currency={currency} balance />}
        </section>
      </div>
    </>
  );
}
function AccountsView({
  accounts,
  onAdd,
}: {
  accounts: Account[];
  onAdd: () => void;
}) {
  const t = useTranslations();
  const [archived, setArchived] = useState(false);
  const groups = accountTypes
    .map((type) => ({
      type,
      accounts: accounts.filter(
        (account) => account.type === type && (archived || !account.archivedAt),
      ),
    }))
    .filter((group) => group.accounts.length);
  return (
    <>
      <label className="check filter-check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        {t("accounts.includeArchived")}
      </label>
      {accounts.length ? (
        groups.map((group) => (
          <section
            key={group.type}
            className="section"
            aria-labelledby={`account-group-${group.type}`}
          >
            <h2 id={`account-group-${group.type}`}>
              {t(`types.${group.type}`)}
            </h2>
            <div className="account-grid">
              {group.accounts.map((account) => (
                <AccountTile key={account.id} account={account} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <Empty
          title={t("dashboard.noAccounts")}
          description={t("dashboard.noAccountsBody")}
        >
          <Button onClick={onAdd}>
            <Plus size={17} />
            {t("accounts.add")}
          </Button>
        </Empty>
      )}
    </>
  );
}
function AccountHistory({
  accountId,
  month,
  accounts,
  categories,
}: {
  accountId: string;
  month: string;
  accounts: Account[];
  categories: Category[];
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const user = useUser();
  const [edit, setEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const client = useQueryClient();
  const router = useRouter();
  const remove = useMutation({
    mutationFn: () => api(`accounts/${accountId}`, {}, "DELETE"),
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => !query.queryKey.includes(accountId),
      });
      router.replace("/accounts");
    },
  });
  const [adjust, setAdjust] = useState(false);
  const [transactionEdit, setTransactionEdit] = useState<Transaction>();
  const [investmentEdit, setInvestmentEdit] = useState<string>();
  const investment = useQuery({
    queryKey: ["investment", investmentEdit],
    queryFn: () => api<EditableInvestment>(`investments/${investmentEdit!}`),
    enabled: !!investmentEdit,
    retry: false,
  });
  const [voiding, setVoiding] = useState<History["entries"][number]>();
  const voidResource =
    voiding?.kind === "INVESTMENT" ? "investments" : "transactions";
  const voidEntry = useMutation({
    mutationFn: () => api(`${voidResource}/${voiding!.id}/void`, {}),
    onSuccess: async () => {
      await client.invalidateQueries();
      setVoiding(undefined);
    },
  });
  const [add, setAdd] = useState(false);
  const history = useQuery({
    queryKey: ["history", accountId, month],
    queryFn: () => api<History>(`accounts/${accountId}/history?month=${month}`),
  });
  if (history.isLoading) return <Loading />;
  if (!history.data) return <ErrorNotice error={history.error} />;
  const h = history.data,
    account = h.account;
  const investmentAccount =
    investment.data?.accountId === account.id
      ? account
      : accounts.find((a) => a.id === investment.data?.accountId);
  return (
    <>
      <div className="section-heading account-history-heading">
        <div>
          <Link className="back-link" href="/accounts">
            {t("common.back")}
          </Link>
          <h2>{account.name}</h2>
        </div>
        <div className="toolbar">
          <IconButton label={t("accounts.edit")} onClick={() => setEdit(true)}>
            <Pencil size={18} />
          </IconButton>
          {!account.archivedAt && (
            <>
              <Button className="secondary" onClick={() => setAdjust(true)}>
                <Scale size={17} />
                {t("accounts.updateBalance")}
              </Button>
              <Button onClick={() => setAdd(true)}>
                <Plus size={17} />
                {t("transactions.add")}
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="account-current-balance">
        <span>{t("accounts.currentBalance")}</span>
        <Money value={account.currentBalance} currency={account.currency} />
      </div>
      <section className="stats-row four">
        <Stat
          label={t("accounts.opening")}
          value={h.opening}
          currency={account.currency}
        />
        <Stat
          label={t("accounts.closing")}
          value={h.closing}
          currency={account.currency}
        />
        <Stat
          label={t("accounts.monthlyIncome")}
          value={h.income}
          currency={account.currency}
          accent="positive"
        />
        <Stat
          label={t("accounts.monthlyExpenses")}
          value={h.expenses}
          currency={account.currency}
        />
      </section>
      <section className="section">
        <h2>{t("accounts.history")}</h2>
        {h.entries.length ? (
          <div className="account-history">
            {h.entries.map((entry) => {
              const tx = entry.transaction;
              const standard = "occurredAt" in tx ? tx : undefined;
              const investmentId = standard
                ? standard.investmentActivityId
                : tx.id;
              const editAccount = standard
                ? accounts.find((a) => a.id === standard.destinationAccountId)
                : account;
              const category =
                "categoryId" in tx
                  ? categories.find((c) => c.id === tx.categoryId)
                  : undefined;
              return (
                <article key={entry.id} className="history-row">
                  <div>
                    <strong>
                      {category
                        ? categoryPath(category, categories, t)
                        : "isOpeningBalance" in tx && tx.isOpeningBalance
                          ? t("accounts.initialBalance")
                          : entry.kind === "STANDARD" && entry.funding
                            ? t("investments.funding")
                            : entry.type === "INCOME" ||
                                entry.type === "EXPENSE"
                              ? t("transactions.uncategorized")
                              : t(`types.${entry.type}`)}
                    </strong>
                    {"description" in tx && tx.description && (
                      <span className="transaction-note">{tx.description}</span>
                    )}
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
                      value={
                        entry.kind === "INVESTMENT" && entry.funding
                          ? entry.funding.amount
                          : entry.delta
                      }
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
                    {entry.type !== "ADJUSTMENT" && (
                      <IconButton
                        label={t(
                          investmentId
                            ? "investments.correct"
                            : "transactions.correct",
                        )}
                        disabled={
                          !!investmentId &&
                          (!editAccount || !!editAccount.archivedAt)
                        }
                        onClick={() =>
                          investmentId
                            ? setInvestmentEdit(investmentId)
                            : setTransactionEdit(standard)
                        }
                      >
                        <Pencil size={15} />
                      </IconButton>
                    )}
                    <IconButton
                      label={t(
                        entry.kind === "INVESTMENT"
                          ? "investments.void"
                          : "transactions.void",
                      )}
                      onClick={() => {
                        voidEntry.reset();
                        setVoiding(entry);
                      }}
                    >
                      <Undo2 size={15} />
                    </IconButton>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty title={t("accounts.noHistory")} />
        )}
      </section>
      {account.type === "INVESTMENT" && (
        <InvestmentView accounts={[account]} embedded />
      )}
      <Modal
        title={t("transactions.correct")}
        open={!!transactionEdit}
        onClose={() => setTransactionEdit(undefined)}
      >
        {transactionEdit && (
          <TransactionForm
            existing={transactionEdit}
            onDone={() => setTransactionEdit(undefined)}
          />
        )}
      </Modal>
      <Modal
        title={t("investments.correct")}
        open={!!investmentEdit}
        onClose={() => setInvestmentEdit(undefined)}
      >
        {investmentEdit &&
          (investment.isLoading ? (
            <Loading />
          ) : investment.data && investmentAccount ? (
            <InvestmentForm
              key={investment.data.id}
              account={investmentAccount}
              existing={investment.data}
              onDone={() => setInvestmentEdit(undefined)}
            />
          ) : investment.error ? (
            <ErrorNotice error={investment.error} />
          ) : null)}
      </Modal>
      <Modal
        title={t(`${voidResource}.voidTitle`)}
        description={t(
          voiding?.funding
            ? "investments.voidFundingBody"
            : `${voidResource}.voidBody`,
        )}
        open={!!voiding}
        onClose={() => {
          if (!voidEntry.isPending) setVoiding(undefined);
        }}
      >
        <ErrorNotice error={voidEntry.error} />
        <div className="form-footer">
          <Button
            className="secondary"
            disabled={voidEntry.isPending}
            onClick={() => setVoiding(undefined)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="danger"
            busy={voidEntry.isPending}
            onClick={() => voidEntry.mutate()}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </Modal>
      <Modal
        title={t(deleting ? "accounts.deleteTitle" : "accounts.edit")}
        open={edit}
        onClose={() => {
          if (!remove.isPending) {
            setEdit(false);
            setDeleting(false);
            remove.reset();
          }
        }}
        description={
          deleting
            ? t("accounts.deleteDescription", { name: account.name })
            : undefined
        }
      >
        {edit &&
          (deleting ? (
            <>
              <ErrorNotice error={remove.error} />
              <div className="form-footer">
                <Button
                  className="secondary"
                  disabled={remove.isPending}
                  onClick={() => {
                    setDeleting(false);
                    remove.reset();
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  className="danger"
                  busy={remove.isPending}
                  onClick={() => remove.mutate()}
                >
                  <Trash2 size={17} />
                  {t("common.delete")}
                </Button>
              </div>
            </>
          ) : (
            <AccountForm
              existing={account}
              onDone={() => setEdit(false)}
              onDelete={() => {
                remove.reset();
                setDeleting(true);
              }}
            />
          ))}
      </Modal>
      <Modal
        title={t("accounts.updateBalance")}
        open={adjust}
        onClose={() => setAdjust(false)}
      >
        {adjust && (
          <BalanceAdjustmentForm
            account={account}
            onDone={() => setAdjust(false)}
          />
        )}
      </Modal>
      <Modal
        title={t("transactions.add")}
        open={add}
        onClose={() => setAdd(false)}
      >
        {add && (
          <TransactionForm accountId={accountId} onDone={() => setAdd(false)} />
        )}
      </Modal>
    </>
  );
}
function TransactionsView({
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
  const [accountId, setAccount] = useState("");
  const [type, setType] = useState("");
  const [categoryId, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = queryString({
    month,
    currency,
    accountId,
    type,
    categoryId,
    startDate: from,
    endDate: to,
  });
  const transactions = useQuery({
    queryKey: ["transactions", query],
    queryFn: () => api<Transaction[]>(`transactions?${query}`),
  });
  return (
    <>
      <div className={transactionStyles.filters}>
        <Field label={t("common.account")}>
          {(id) => (
            <Dropdown
              id={id}
              value={accountId}
              onValueChange={(value) => setAccount(value)}
              aria-label={t("common.account")}
            >
              <option value="">{t("common.all")}</option>
              {accounts
                .filter((a) => a.currency === currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Dropdown>
          )}
        </Field>
        <Field label={t("common.type")}>
          {(id) => (
            <Dropdown
              id={id}
              value={type}
              onValueChange={(value) => {
                setType(value);
                setCategory("");
              }}
              aria-label={t("common.type")}
            >
              <option value="">{t("common.all")}</option>
              {ledgerTypes.map((v) => (
                <option key={v} value={v}>
                  {t(`types.${v}`)}
                </option>
              ))}
            </Dropdown>
          )}
        </Field>
        <Field label={t("common.category")}>
          {(id) => (
            <Dropdown
              id={id}
              value={categoryId}
              onValueChange={(value) => setCategory(value)}
              aria-label={t("common.category")}
              disabled={type === "TRANSFER" || type === "ADJUSTMENT"}
            >
              <option value="">{t("common.all")}</option>
              {categories
                .filter((c) => !type || c.type === type)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {categoryPath(c, categories, t)}
                  </option>
                ))}
            </Dropdown>
          )}
        </Field>
        <Field label={t("common.startDate")}>
          {(id) => (
            <input
              id={id}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </Field>
        <Field label={t("common.endDate")}>
          {(id) => (
            <input
              id={id}
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </Field>
      </div>
      <ErrorNotice error={transactions.error} />
      {transactions.isLoading ? (
        <Loading />
      ) : (
        <section className="section">
          <div className="section-heading">
            <h2>
              {t("transactions.count", {
                count: transactions.data?.length ?? 0,
              })}
            </h2>
          </div>
          <TransactionList
            transactions={transactions.data ?? []}
            accounts={accounts}
            categories={categories}
          />
        </section>
      )}
    </>
  );
}
