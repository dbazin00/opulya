import type { Locale } from "./validation.js";
export function resolveLocale(value?: string | null): Locale {
  return value?.toLowerCase().split(/[-_,;]/)[0] === "hr" ? "hr" : "en";
}
export function preferredLocale(header?: string | null): Locale {
  const choices = (header ?? "")
    .split(",")
    .map((part) => {
      const [language, quality] = part.trim().split(";q=");
      return {
        language: language ?? "",
        quality: quality ? Number(quality) : 1,
      };
    })
    .sort((a, b) => b.quality - a.quality);
  return resolveLocale(
    choices.find((c) => /^(en|hr)(-|$)/i.test(c.language) && c.quality > 0)
      ?.language,
  );
}
export const formatMoney = (
  value: string | number,
  currency: string,
  locale: Locale,
  maximumFractionDigits?: number,
) =>
  new Intl.NumberFormat(locale === "hr" ? "hr-HR" : "en-IE", {
    style: "currency",
    currency,
    ...(maximumFractionDigits === undefined ? {} : { maximumFractionDigits }),
  }).format(value as unknown as number);
export const formatDate = (
  value: string | Date,
  locale: Locale,
  timeZone = "Europe/Zagreb",
) => {
  const formatter = new Intl.DateTimeFormat(
    locale === "hr" ? "hr-HR" : "en-US",
    {
      year: "numeric",
      month: locale === "hr" ? "numeric" : "short",
      day: "numeric",
      timeZone,
    },
  );
  return formatter
    .formatToParts(new Date(value))
    .map((part) =>
      locale === "hr" && (part.type === "month" || part.type === "day")
        ? String(Number(part.value))
        : part.value,
    )
    .join("");
};
export const formatQuantity = (value: string, locale: Locale) =>
  new Intl.NumberFormat(locale === "hr" ? "hr-HR" : "en-US", {
    maximumFractionDigits: 12,
  }).format(value as unknown as number);
export const formatTime = (
  value: string | Date,
  locale: Locale,
  timeZone = "Europe/Zagreb",
) =>
  new Intl.DateTimeFormat(locale === "hr" ? "hr-HR" : "en-US", {
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
export const priceRefreshInterval = (visible: boolean, online: boolean) =>
  visible && online ? 60_000 : false;
