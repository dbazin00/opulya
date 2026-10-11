"use client";
import { useId, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useLocale, useTranslations } from "next-intl";
import * as Dialog from "@radix-ui/react-dialog";
import {
  X,
  Inbox,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { formatMoney, resolveLocale } from "@opulya/shared";
import { ApiError } from "@/lib/api";
export function Spinner({
  label,
  size = 18,
  showLabel = false,
  decorative = false,
  className = "",
}: {
  label?: string;
  size?: number;
  showLabel?: boolean;
  decorative?: boolean;
  className?: string;
}) {
  const t = useTranslations();
  const name = label ?? t("common.loading");
  return (
    <span
      className={`spinner ${className}`}
      role={decorative ? undefined : "status"}
      aria-label={!decorative && !showLabel ? name : undefined}
      aria-hidden={decorative || undefined}
    >
      <LoaderCircle
        size={size}
        strokeWidth={1.8}
        className="spinner-icon"
        aria-hidden="true"
      />
      {showLabel && <span>{name}</span>}
    </span>
  );
}
export function Button({
  children,
  className = "",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={`button ${busy ? "is-busy" : ""} ${className}`}
    >
      <span className="button-content">{children}</span>
      {busy && (
        <Spinner size={18} decorative className="button-busy-indicator" />
      )}
    </button>
  );
}
export function IconButton({
  label,
  children,
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={props.disabled || busy}
      className={`icon-button ${props.className ?? ""}`}
    >
      {busy ? <Spinner size={18} decorative /> : children}
    </button>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: (id: string) => ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small>{hint}</small>}
    </div>
  );
}
export function Modal({
  title,
  open,
  onClose,
  children,
  description,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  description?: string;
}) {
  const t = useTranslations();
  const descriptionId = useId();
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content"
          aria-describedby={description ? descriptionId : undefined}
        >
          <div className="dialog-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label={t("common.close")}>
                <X size={20} />
              </IconButton>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description id={descriptionId} className="muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Money({
  value,
  currency,
  className = "",
  placeholder,
  maximumFractionDigits,
}: {
  value: string | null | undefined;
  currency: string;
  className?: string;
  placeholder?: string;
  maximumFractionDigits?: number;
}) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations();
  return (
    <span
      className={`money ${className} ${value == null && placeholder ? "money-placeholder" : ""}`}
    >
      {value == null ? (
        placeholder ? (
          <Spinner label={placeholder} size={18} />
        ) : (
          t("common.unavailable")
        )
      ) : (
        formatMoney(value, currency, locale, maximumFractionDigits)
      )}
    </span>
  );
}
export function ErrorNotice({ error }: { error: unknown }) {
  const t = useTranslations();
  if (!error) return null;
  const key = error instanceof ApiError ? error.code : "REQUEST_FAILED";
  return (
    <p role="alert" className="error-notice">
      {t.has(`errors.${key}`) ? t(`errors.${key}`) : t("errors.REQUEST_FAILED")}
    </p>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Inbox size={25} aria-hidden />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Loading() {
  const t = useTranslations();
  return (
    <Spinner
      size={24}
      label={t("common.loading")}
      showLabel
      className="loading"
    />
  );
}
export function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations();
  const move = (step: number) => {
    const date = new Date(`${value}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    onChange(date.toISOString().slice(0, 7));
  };
  return (
    <div className="month-picker">
      <IconButton label={t("common.previous")} onClick={() => move(-1)}>
        <ChevronLeft size={18} />
      </IconButton>
      <input
        type="month"
        value={value}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        aria-label={t("common.month")}
      />
      <IconButton label={t("common.next")} onClick={() => move(1)}>
        <ChevronRight size={18} />
      </IconButton>
    </div>
  );
}
export function Stat({
  label,
  value,
  currency,
  accent = "",
  placeholder,
}: {
  label: string;
  value: string | null | undefined;
  currency: string;
  accent?: string;
  placeholder?: string;
}) {
  return (
    <div className={`stat ${accent}`}>
      <span>{label}</span>
      <Money value={value} currency={currency} placeholder={placeholder} />
    </div>
  );
}
