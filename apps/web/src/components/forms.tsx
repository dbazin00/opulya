"use client";
import { Dropdown } from "./dropdown";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  accountTypes,
  decimal,
  descendants,
  formatMoney,
  investmentTypes,
  resolveLocale,
  transactionTypes,
} from "@opulya/shared";
import { api, ApiError } from "@/lib/api";
import { listingExchange } from "@/lib/listing";
import type {
  Account,
  Asset,
  Category,
  EditableInvestment,
  Transaction,
} from "@/lib/types";
import { Button, Empty, ErrorNotice, Field, Loading, Money } from "./ui";
import { useCurrencies } from "./providers";

type Translator = ReturnType<typeof useTranslations>;
export const categoryName = (
  c: Pick<Category, "name" | "defaultKey">,
  t: Translator,
) =>
  c.name ?? (c.defaultKey ? t(`defaults.${c.defaultKey}`) : t("common.none"));
export function categoryPath(
  category: Category,
  categories: Category[],
  t: Translator,
) {
  const path = [categoryName(category, t)];
  const visited = new Set([category.id]);
  let parent = category.parentId;
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const c = categories.find((v) => v.id === parent);
    if (!c) break;
    path.unshift(categoryName(c, t));
    parent = c.parentId;
  }
  return path.join(" / ");
}
export function localDateTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function useSave(path: string, onDone: () => void, method = "POST") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: unknown) => api(path, body, method),
    onSuccess: async () => {
      await client.invalidateQueries();
      onDone();
    },
  });
}
function Form({
  children,
  onSubmit,
  error,
  busy,
  secondaryAction,
}: {
  children: ReactNode;
  onSubmit: (data: Record<string, string>) => void;
  error: unknown;
  busy: boolean;
  secondaryAction?: ReactNode;
}) {
  const t = useTranslations();
  return (
    <form
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(
          Object.fromEntries(new FormData(e.currentTarget)) as Record<
            string,
            string
          >,
        );
      }}
    >
      {children}
      <ErrorNotice error={error} />
      <div className="form-footer">
        {secondaryAction}
        <Button type="submit" busy={busy}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}
export function AccountForm({
  onDone,
  existing,
  onDelete,
}: {
  onDone: () => void;
  existing?: Account;
  onDelete?: () => void;
}) {
  const t = useTranslations();
  const currencies = useCurrencies();
  const [type, setType] = useState(existing?.type ?? "BANK");
  const save = useSave(
    existing ? `accounts/${existing.id}` : "accounts",
    onDone,
    existing ? "PATCH" : "POST",
  );
  return (
    <Form
      busy={save.isPending}
      error={save.error}
      secondaryAction={
        existing?.canDelete && onDelete ? (
          <Button
            type="button"
            className="secondary"
            disabled={save.isPending}
            onClick={onDelete}
          >
            <Trash2 size={17} />
            {t("common.delete")}
          </Button>
        ) : undefined
      }
      onSubmit={(data) =>
        save.mutate(
          existing
            ? { name: data.name, type, archived: data.archived === "on" }
            : {
                name: data.name,
                currency: data.currency,
                initialBalance: data.initialBalance,
                type,
                recordInitialBalance: data.recordInitialBalance === "on",
              },
        )
      }
    >
      <Field label={t("common.name")}>
        {(id) => (
          <input
            id={id}
            name="name"
            defaultValue={existing?.name}
            required
            maxLength={100}
            autoFocus
          />
        )}
      </Field>
      {existing ? (
        <>
          <Field
            label={t("common.type")}
            hint={
              !existing.canChangeInvestmentType
                ? t("accounts.investmentTypeLocked")
                : undefined
            }
          >
            {(id) => (
              <Dropdown
                id={id}
                value={type}
                disabled={
                  existing.type === "INVESTMENT" &&
                  !existing.canChangeInvestmentType
                }
                onValueChange={(value) => setType(value as typeof type)}
              >
                {accountTypes.map((v) => (
                  <option
                    key={v}
                    value={v}
                    disabled={
                      !existing.canChangeInvestmentType &&
                      v !== existing.type &&
                      (v === "INVESTMENT" || existing.type === "INVESTMENT")
                    }
                  >
                    {t(`types.${v}`)}
                  </option>
                ))}
              </Dropdown>
            )}
          </Field>
          <label className="check">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={!!existing.archivedAt}
            />
            {t("common.archived")}
          </label>
          {!existing.canDelete && (
            <p className="muted">{t("accounts.hasHistory")}</p>
          )}
        </>
      ) : (
        <>
          <div className="form-grid">
            <Field label={t("common.type")}>
              {(id) => (
                <Dropdown
                  id={id}
                  value={type}
                  onValueChange={(value) => setType(value as typeof type)}
                >
                  {accountTypes.map((v) => (
                    <option key={v} value={v}>
                      {t(`types.${v}`)}
                    </option>
                  ))}
                </Dropdown>
              )}
            </Field>
            <Field label={t("common.currency")}>
              {(id) => (
                <Dropdown id={id} name="currency" defaultValue="EUR">
                  {currencies.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </Dropdown>
              )}
            </Field>
          </div>
          <Field
            label={t("accounts.initialBalance")}
            hint={t("accounts.initialHint")}
          >
            {(id) => (
              <input
                id={id}
                name="initialBalance"
                type="number"
                step="any"
                defaultValue="0"
                required
                inputMode="decimal"
              />
            )}
          </Field>
          <label className="check balance-record-check">
            <input type="checkbox" name="recordInitialBalance" />
            {t("accounts.recordInitialBalance")}
          </label>
        </>
      )}
    </Form>
  );
}
export function BalanceAdjustmentForm({
  account,
  onDone,
}: {
  account: Account;
  onDone: () => void;
}) {
  const t = useTranslations();
  const [expectedBalance] = useState(account.currentBalance);
  const [balance, setBalance] = useState(expectedBalance);
  const [requestId] = useState(() => crypto.randomUUID());
  const save = useSave(`accounts/${account.id}/balance`, onDone);
  let difference: string | null = null;
  try {
    if (/^-?\d+(\.\d+)?$/.test(balance))
      difference = decimal(balance).sub(expectedBalance).toFixed();
  } catch {
    /* The field can contain an incomplete decimal while typing. */
  }
  return (
    <Form
      busy={save.isPending}
      error={save.error}
      onSubmit={(data) =>
        save.mutate({
          balance,
          expectedBalance,
          description: data.description || null,
          clientRequestId: requestId,
          recordTransaction: data.recordTransaction === "on",
        })
      }
    >
      <div className="balance-adjustment-summary">
        <span>{t("accounts.currentBalance")}</span>
        <Money value={expectedBalance} currency={account.currency} />
      </div>
      <Field label={`${t("accounts.newBalance")} (${account.currency})`}>
        {(id) => (
          <input
            id={id}
            name="balance"
            type="number"
            step="any"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            required
            autoFocus
          />
        )}
      </Field>
      <div className="balance-adjustment-summary" aria-live="polite">
        <span>{t("types.ADJUSTMENT")}</span>
        <Money value={difference} currency={account.currency} />
      </div>
      <p className="notice">
        {t(
          account.type === "INVESTMENT"
            ? "accounts.cashAdjustmentHint"
            : "accounts.adjustmentHint",
        )}
      </p>
      <Field label={t("common.description")}>
        {(id) => (
          <textarea id={id} name="description" rows={2} maxLength={500} />
        )}
      </Field>
      <label className="check balance-record-check">
        <input type="checkbox" name="recordTransaction" defaultChecked />
        {t("accounts.recordBalanceChange")}
      </label>
      {save.error instanceof ApiError &&
        save.error.code === "BALANCE_CHANGED" && (
          <Button
            type="button"
            className="secondary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} />
            {t("common.refresh")}
          </Button>
        )}
    </Form>
  );
}
export function TransactionForm({
  onDone,
  existing,
  accountId,
}: {
  onDone: () => void;
  existing?: Transaction;
  accountId?: string;
}) {
  const t = useTranslations();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("accounts"),
  });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("categories"),
  });
  const [type, setType] = useState(existing?.type ?? "EXPENSE");
  const [chosenCategory, setChosenCategory] = useState(
    existing?.categoryId ?? "",
  );
  const [timestampChanged, setTimestampChanged] = useState(false);
  const [chosen, setChosen] = useState(
    existing?.sourceAccountId ??
      existing?.destinationAccountId ??
      accountId ??
      "",
  );
  const [requestId] = useState(() => crypto.randomUUID());
  const save = useSave("transactions", onDone);
  if (accounts.isLoading || categories.isLoading) return <Loading />;
  if (accounts.error || categories.error)
    return <ErrorNotice error={accounts.error || categories.error} />;
  const list = (accounts.data ?? []).filter((a) => !a.archivedAt);
  const selected = list.find((a) => a.id === chosen) ?? list[0];
  const availableCategories = (categories.data ?? []).filter(
    (c) => c.type === type && (!c.archivedAt || c.id === existing?.categoryId),
  );
  if (!selected)
    return (
      <Empty title={t("dashboard.noAccounts")}>
        <Link className="button" href="/accounts" onClick={onDone}>
          {t("accounts.add")}
        </Link>
      </Empty>
    );
  return (
    <Form
      busy={save.isPending}
      error={save.error}
      onSubmit={(data) =>
        save.mutate({
          type,
          amount: data.amount,
          currency: selected.currency,
          sourceAccountId: type === "INCOME" ? null : selected.id,
          destinationAccountId:
            type === "INCOME"
              ? selected.id
              : type === "TRANSFER"
                ? data.destinationAccountId
                : null,
          categoryId: type === "TRANSFER" ? null : data.categoryId || null,
          description: data.description || null,
          occurredAt:
            existing && !timestampChanged
              ? existing.occurredAt
              : new Date(data.occurredAt!).toISOString(),
          clientRequestId: requestId,
          ...(existing ? { replacesId: existing.id } : {}),
        })
      }
    >
      {existing && <p className="notice">{t("transactions.correction")}</p>}
      <div className="segmented">
        {transactionTypes.map((v) => (
          <button
            type="button"
            key={v}
            className={type === v ? "selected" : ""}
            aria-pressed={type === v}
            onClick={() => {
              if (v !== type) setChosenCategory("");
              setType(v);
            }}
          >
            {t(`types.${v}`)}
          </button>
        ))}
      </div>
      <Field label={`${t("common.amount")} (${selected.currency})`}>
        {(id) => (
          <input
            id={id}
            name="amount"
            type="number"
            inputMode="decimal"
            min="0.00000001"
            step="any"
            defaultValue={existing?.amount}
            required
            autoFocus
          />
        )}
      </Field>
      <Field
        label={t(
          type === "TRANSFER" ? "transactions.source" : "common.account",
        )}
      >
        {(id) => (
          <Dropdown
            id={id}
            value={selected.id}
            sort="label"
            onValueChange={(value) => setChosen(value)}
          >
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Dropdown>
        )}
      </Field>
      {type === "TRANSFER" ? (
        <Field label={t("transactions.destination")}>
          {(id) => (
            <Dropdown
              id={id}
              name="destinationAccountId"
              sort="label"
              defaultValue={existing?.destinationAccountId ?? ""}
              required
            >
              <option value="">{t("common.none")}</option>
              {list
                .filter(
                  (a) =>
                    a.id !== selected.id && a.currency === selected.currency,
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Dropdown>
          )}
        </Field>
      ) : (
        <Field label={t("common.category")}>
          {(id) => (
            <Dropdown
              id={id}
              name="categoryId"
              sort="path"
              value={chosenCategory}
              onValueChange={setChosenCategory}
              required
            >
              <option value="">{t("transactions.selectCategory")}</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPath(c, categories.data!, t)}
                </option>
              ))}
            </Dropdown>
          )}
        </Field>
      )}
      {type !== "TRANSFER" && availableCategories.length === 0 && (
        <p className="notice">
          {t("transactions.noCategories")}{" "}
          <Link href="/categories" onClick={onDone}>
            {t("categories.add")}
          </Link>
        </p>
      )}
      <Field
        label={t("common.date")}
        hint={Intl.DateTimeFormat().resolvedOptions().timeZone}
      >
        {(id) => (
          <input
            id={id}
            name="occurredAt"
            type="datetime-local"
            defaultValue={localDateTime(existing?.occurredAt)}
            max={localDateTime()}
            onChange={() => setTimestampChanged(true)}
            required
          />
        )}
      </Field>
      <Field label={t("common.description")}>
        {(id) => (
          <textarea
            id={id}
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={existing?.description ?? ""}
          />
        )}
      </Field>
    </Form>
  );
}
export function CategoryForm({
  onDone,
  categories,
  existing,
  parentId,
  initialType = "EXPENSE",
  secondaryAction,
}: {
  onDone: () => void;
  categories: Category[];
  existing?: Category;
  parentId?: string;
  initialType?: Category["type"];
  secondaryAction?: ReactNode;
}) {
  const t = useTranslations();
  const [type, setType] = useState(
    existing?.type ??
      categories.find((c) => c.id === parentId)?.type ??
      initialType,
  );
  const save = useSave(
    existing ? `categories/${existing.id}` : "categories",
    onDone,
    existing ? "PATCH" : "POST",
  );
  const excluded = existing
    ? descendants(categories, existing.id)
    : new Set<string>();
  return (
    <Form
      busy={save.isPending}
      error={save.error}
      secondaryAction={secondaryAction}
      onSubmit={(data) =>
        save.mutate({
          name: data.name,
          parentId: data.parentId || null,
          ...(!existing ? { type } : {}),
        })
      }
    >
      <Field label={t("common.name")}>
        {(id) => (
          <input
            id={id}
            name="name"
            defaultValue={existing ? categoryName(existing, t) : ""}
            required
            maxLength={100}
            autoFocus
          />
        )}
      </Field>
      {!existing && (
        <Field label={t("common.type")}>
          {(id) => (
            <Dropdown
              id={id}
              value={type}
              onValueChange={(value) => setType(value as typeof type)}
            >
              <option value="EXPENSE">{t("types.EXPENSE")}</option>
              <option value="INCOME">{t("types.INCOME")}</option>
            </Dropdown>
          )}
        </Field>
      )}
      <Field label={t("categories.parent")}>
        {(id) => (
          <Dropdown
            id={id}
            name="parentId"
            sort="path"
            defaultValue={existing?.parentId ?? parentId ?? ""}
          >
            <option value="">{t("categories.root")}</option>
            {categories
              .filter(
                (c) => c.type === type && !c.archivedAt && !excluded.has(c.id),
              )
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPath(c, categories, t)}
                </option>
              ))}
          </Dropdown>
        )}
      </Field>
    </Form>
  );
}
export function InvestmentForm({
  account,
  onDone,
  existing,
}: {
  account: Account;
  onDone: () => void;
  existing?: EditableInvestment;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const [type, setType] = useState<(typeof investmentTypes)[number]>(
    existing?.type ?? "BUY",
  );
  const [qty, setQty] = useState(existing?.quantity ?? "");
  const [price, setPrice] = useState(existing?.pricePerUnit ?? "");
  const [source, setSource] = useState(existing?.sourceAccountId ?? "");
  const [fee, setFee] = useState(existing?.fee ?? "0");
  const [depositAmount, setDepositAmount] = useState(
    existing?.totalAmount ?? "",
  );
  const [chosenAsset, setChosenAsset] = useState(existing?.assetId ?? "");
  const [timestampChanged, setTimestampChanged] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const assets = useQuery({
    queryKey: ["assets"],
    queryFn: () => api<Asset[]>("assets"),
  });
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<Account[]>("accounts"),
  });
  const save = useSave("investments", onDone);
  const trade = type === "BUY" || type === "SELL";
  const assetNeeded = trade || type === "DIVIDEND";
  const fundingAllowed = type === "BUY" || type === "DEPOSIT";
  let total = "";
  try {
    if (qty && price)
      total = decimal(qty).mul(price).toDecimalPlaces(8).toFixed();
  } catch {
    /* Native number fields may temporarily contain an incomplete value. */
  }
  let debit = "";
  try {
    const amount = trade ? total : depositAmount;
    if (amount && source && fundingAllowed)
      debit = decimal(amount)
        .add(type === "BUY" ? fee : "0")
        .toFixed();
  } catch {
    /* Show the calculated debit only while the numeric input is valid. */
  }
  if (assets.isLoading || accounts.isLoading) return <Loading />;
  if (assets.error || accounts.error)
    return <ErrorNotice error={assets.error || accounts.error} />;
  return (
    <Form
      busy={save.isPending}
      error={save.error || assets.error || accounts.error}
      onSubmit={(data) =>
        save.mutate({
          accountId: account.id,
          sourceAccountId: fundingAllowed ? source || null : null,
          type,
          assetId: assetNeeded ? data.assetId : null,
          quantity: trade ? qty : null,
          pricePerUnit: trade ? price : null,
          totalAmount: trade ? total : data.totalAmount,
          fee: assetNeeded ? data.fee : "0",
          currency: account.currency,
          executedAt:
            existing && !timestampChanged
              ? existing.executedAt
              : new Date(data.executedAt!).toISOString(),
          clientRequestId: requestId,
          ...(existing ? { replacesId: existing.id } : {}),
        })
      }
    >
      {existing && <p className="notice">{t("investments.correction")}</p>}
      <Field label={t("common.type")}>
        {(id) => (
          <Dropdown
            id={id}
            value={type}
            onValueChange={(value) => {
              setType(value as typeof type);
              setSource("");
            }}
          >
            {investmentTypes.map((v) => (
              <option key={v} value={v}>
                {t(`types.${v}`)}
              </option>
            ))}
          </Dropdown>
        )}
      </Field>
      {assetNeeded && (
        <Field label={t("investments.asset")}>
          {(id) => (
            <Dropdown
              id={id}
              name="assetId"
              sort="label"
              value={chosenAsset}
              onValueChange={setChosenAsset}
              required
            >
              <option value="">{t("common.none")}</option>
              {assets.data
                ?.filter((a) => a.currency === account.currency)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {listingExchange(a) || t(`types.${a.assetType}`)}{" "}
                    · {a.currency} · {a.symbol}
                  </option>
                ))}
            </Dropdown>
          )}
        </Field>
      )}
      {fundingAllowed && (
        <Field label={t("investments.fundingSource")}>
          {(id) => (
            <Dropdown
              id={id}
              name="sourceAccountId"
              sort="label"
              value={source}
              onValueChange={setSource}
              required
            >
              <option value="">{t("investments.chooseFundingSource")}</option>
              {accounts.data
                ?.filter(
                  (a) =>
                    !a.archivedAt &&
                    a.type !== "INVESTMENT" &&
                    a.currency === account.currency,
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Dropdown>
          )}
        </Field>
      )}
      {trade && (
        <div className="form-grid">
          <Field label={t("investments.quantity")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="any"
                min="0.000000000001"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label={t("investments.pricePerUnit")}>
            {(id) => (
              <input
                id={id}
                type="number"
                step="any"
                min="0.00000001"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
      )}
      <Field label={`${t("investments.totalAmount")} (${account.currency})`}>
        {(id) =>
          trade ? (
            <input
              id={id}
              readOnly
              value={total ? formatMoney(total, account.currency, locale) : ""}
            />
          ) : (
            <input
              id={id}
              name="totalAmount"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              type="number"
              step="any"
              min="0.00000001"
              required
            />
          )
        }
      </Field>
      {assetNeeded && (
        <Field label={t("investments.fee")}>
          {(id) => (
            <input
              id={id}
              name="fee"
              type="number"
              step="any"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              required
            />
          )}
        </Field>
      )}
      {debit && (
        <div className="account-current-balance" aria-live="polite">
          <span>{t("investments.sourceDebit")}</span>
          <Money value={debit} currency={account.currency} />
        </div>
      )}
      <Field
        label={t("common.date")}
        hint={Intl.DateTimeFormat().resolvedOptions().timeZone}
      >
        {(id) => (
          <input
            id={id}
            name="executedAt"
            type="datetime-local"
            defaultValue={localDateTime(existing?.executedAt)}
            max={localDateTime()}
            onChange={() => setTimestampChanged(true)}
            required
          />
        )}
      </Field>
    </Form>
  );
}
