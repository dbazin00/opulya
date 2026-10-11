"use client";
import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Scale,
  Pencil,
  Undo2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate, formatTime, resolveLocale } from "@opulya/shared";
import { api } from "@/lib/api";
import type {
  Account,
  Category,
  EditableInvestment,
  Transaction,
} from "@/lib/types";
import { useUser } from "./providers";
import {
  Button,
  Empty,
  ErrorNotice,
  IconButton,
  Loading,
  Modal,
  Money,
} from "./ui";
import { categoryPath, InvestmentForm, TransactionForm } from "./forms";
export function TransactionList({
  transactions,
  accounts,
  categories,
  compact = false,
}: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  compact?: boolean;
}) {
  const t = useTranslations();
  const locale = resolveLocale(useLocale());
  const user = useUser();
  const [edit, setEdit] = useState<Transaction>();
  const [investmentEdit, setInvestmentEdit] = useState<Transaction>();
  const investmentAccount = accounts.find(
    (account) => account.id === investmentEdit?.destinationAccountId,
  );
  const investment = useQuery({
    queryKey: ["investment", investmentEdit?.investmentActivityId],
    queryFn: () =>
      api<EditableInvestment>(
        `investments/${investmentEdit!.investmentActivityId}`,
      ),
    enabled: !!investmentEdit?.investmentActivityId,
    retry: false,
  });
  const [voiding, setVoiding] = useState<Transaction>();
  const client = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`transactions/${voiding!.id}/void`, {}),
    onSuccess: async () => {
      await client.invalidateQueries();
      setVoiding(undefined);
    },
  });
  if (!transactions.length) return <Empty title={t("transactions.empty")} />;
  return (
    <>
      <div className={`transaction-list${compact ? " is-compact" : ""}`}>
        {transactions.map((tx) => {
          const category = categories.find((c) => c.id === tx.categoryId);
          const source = accounts.find((a) => a.id === tx.sourceAccountId);
          const destination = accounts.find(
            (a) => a.id === tx.destinationAccountId,
          );
          const Icon =
            tx.type === "ADJUSTMENT"
              ? Scale
              : tx.type === "TRANSFER"
                ? ArrowLeftRight
                : tx.type === "INCOME"
                  ? ArrowDownLeft
                  : ArrowUpRight;
          return (
            <article key={tx.id} className="transaction-row">
              <span className={`transaction-icon ${tx.type.toLowerCase()}`}>
                <Icon size={18} aria-hidden />
              </span>
              <div className="transaction-description">
                <strong>
                  {category
                    ? categoryPath(category, categories, t)
                    : tx.isOpeningBalance
                      ? t("accounts.initialBalance")
                      : tx.investmentActivityId
                        ? t("investments.funding")
                        : tx.type === "INCOME" || tx.type === "EXPENSE"
                          ? t("transactions.uncategorized")
                          : t(`types.${tx.type}`)}
                </strong>
                {tx.description && (
                  <span className="transaction-note">{tx.description}</span>
                )}
                <span>
                  {t(`types.${tx.type}`)} · {source?.name}
                  {source && destination ? " → " : ""}
                  {destination?.name}
                </span>
                <time dateTime={tx.occurredAt}>
                  {formatDate(tx.occurredAt, locale, user.timeZone)}
                  {" · "}
                  {formatTime(tx.occurredAt, locale, user.timeZone)}
                </time>
              </div>
              <div className="transaction-value">
                <Money
                  value={
                    tx.type === "EXPENSE" ||
                    (tx.type === "ADJUSTMENT" && tx.sourceAccountId)
                      ? `-${tx.amount}`
                      : tx.amount
                  }
                  currency={tx.currency}
                  className={`transaction-amount ${tx.type.toLowerCase()}`}
                />
                <dl className="transaction-balances">
                  {source && tx.sourceBalanceAfter != null && (
                    <div>
                      <dt className={destination ? undefined : "sr-only"}>
                        {destination ? (
                          <>
                            <span className="sr-only">
                              {t("accounts.after")} ·{" "}
                            </span>
                            {source.name}
                          </>
                        ) : (
                          t("accounts.after")
                        )}
                      </dt>
                      <dd>
                        <Money
                          value={tx.sourceBalanceAfter}
                          currency={tx.currency}
                        />
                      </dd>
                    </div>
                  )}
                  {destination && tx.destinationBalanceAfter != null && (
                    <div>
                      <dt className={source ? undefined : "sr-only"}>
                        {source ? (
                          <>
                            <span className="sr-only">
                              {t("accounts.after")} ·{" "}
                            </span>
                            {destination.name}
                          </>
                        ) : (
                          t("accounts.after")
                        )}
                      </dt>
                      <dd>
                        <Money
                          value={tx.destinationBalanceAfter}
                          currency={tx.currency}
                        />
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
              {!compact && (
                <div className="row-actions">
                  {tx.type !== "ADJUSTMENT" && (
                    <IconButton
                      label={t(
                        tx.investmentActivityId
                          ? "investments.correct"
                          : "transactions.correct",
                      )}
                      disabled={
                        !!tx.investmentActivityId &&
                        (!destination || !!destination.archivedAt)
                      }
                      onClick={() =>
                        tx.investmentActivityId
                          ? setInvestmentEdit(tx)
                          : setEdit(tx)
                      }
                    >
                      <Pencil size={15} />
                    </IconButton>
                  )}
                  <IconButton
                    label={t("transactions.void")}
                    onClick={() => {
                      remove.reset();
                      setVoiding(tx);
                    }}
                  >
                    <Undo2 size={15} />
                  </IconButton>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <Modal
        title={t("transactions.correct")}
        open={!!edit}
        onClose={() => setEdit(undefined)}
      >
        {edit && (
          <TransactionForm existing={edit} onDone={() => setEdit(undefined)} />
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
        title={t("transactions.voidTitle")}
        description={t(
          voiding?.investmentActivityId
            ? "investments.voidFundingBody"
            : "transactions.voidBody",
        )}
        open={!!voiding}
        onClose={() => setVoiding(undefined)}
      >
        <ErrorNotice error={remove.error} />
        <div className="form-footer">
          <Button className="secondary" onClick={() => setVoiding(undefined)}>
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
