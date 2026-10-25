"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import type { resolveBudget } from "@opulya/shared";
import { api } from "@/lib/api";
import { Dropdown } from "./dropdown";
import { Button, ErrorNotice, Field } from "./ui";

type BudgetRow = ReturnType<typeof resolveBudget>;
export type BudgetTarget = { categoryId: string } | { assetId: string };

export function BudgetRemoval({
  target,
  month,
  currency,
  onDone,
}: {
  target: BudgetTarget;
  month: string;
  currency: string;
  onDone: () => void;
}) {
  const t = useTranslations();
  const client = useQueryClient();
  const [scope, setScope] = useState<"MONTH" | "RECURRING" | "ALL">("MONTH");
  const remove = useMutation({
    mutationFn: () =>
      api(
        "budgets",
        {
          ...target,
          currency,
          ...(scope === "ALL" ? {} : { month, scope, amount: null }),
        },
        scope === "ALL" ? "DELETE" : "POST",
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["budgets"] });
      await client.invalidateQueries({ queryKey: ["categories"] });
      await client.invalidateQueries({ queryKey: ["assets"] });
      onDone();
    },
  });
  return (
    <form
      className="entry-form"
      onSubmit={(event) => {
        event.preventDefault();
        remove.mutate();
      }}
    >
      <Field label={t("budgets.scope")}>
        {(id) => (
          <Dropdown
            id={id}
            value={scope}
            onValueChange={(value) =>
              setScope(value as "MONTH" | "RECURRING" | "ALL")
            }
            disabled={remove.isPending}
          >
            <option value="MONTH">{t("budgets.monthOnly")}</option>
            <option value="RECURRING">{t("budgets.recurring")}</option>
            <option value="ALL">{t("budgets.deleteAll")}</option>
          </Dropdown>
        )}
      </Field>
      <p role="status">
        {t(
          scope === "ALL"
            ? "assetId" in target
              ? "budgets.deleteAssetConfirm"
              : "budgets.deleteConfirm"
            : scope === "MONTH"
              ? "budgets.removeConfirm"
              : "budgets.stopConfirm",
          { currency },
        )}
      </p>
      <ErrorNotice error={remove.error} />
      <div className="form-footer">
        <Button
          type="button"
          className="secondary"
          disabled={remove.isPending}
          onClick={onDone}
        >
          {t("common.cancel")}
        </Button>
        <Button type="submit" className="danger" busy={remove.isPending}>
          <Trash2 size={17} aria-hidden="true" />
          {t(scope === "ALL" ? "budgets.delete" : "budgets.remove")}
        </Button>
      </div>
    </form>
  );
}

export function BudgetForm({
  target,
  archived = false,
  row,
  month,
  currency,
  onDone,
  targetOptions,
  onTargetChange,
}: {
  target: BudgetTarget;
  archived?: boolean;
  row: BudgetRow;
  month: string;
  currency: string;
  onDone: () => void;
  targetOptions?: { id: string; label: string }[];
  onTargetChange: (id: string) => void;
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
          ...target,
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
      await client.invalidateQueries({ queryKey: ["assets"] });
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
      {targetOptions && (
        <Field
          label={t("assetId" in target ? "assets.asset" : "budgets.category")}
        >
          {(id) => (
            <Dropdown
              id={id}
              value={"assetId" in target ? target.assetId : target.categoryId}
              sort={"assetId" in target ? "label" : "path"}
              onValueChange={onTargetChange}
              disabled={save.isPending}
            >
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </Dropdown>
          )}
        </Field>
      )}
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
            disabled={archived || save.isPending || confirmRemove}
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
          <Button type="submit" busy={save.isPending} disabled={archived}>
            {t("common.save")}
          </Button>
        )}
      </div>
    </form>
  );
}
