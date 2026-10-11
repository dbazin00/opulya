"use client";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { SelectControl } from "./dropdown";

export function LanguageSelect({
  id,
  label,
  name,
  value,
  defaultValue,
  onValueChange,
  disabled,
}: {
  id?: string;
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (locale: "en" | "hr") => void;
  disabled?: boolean;
}) {
  const t = useTranslations();
  return (
    <SelectControl
      id={id}
      aria-label={label}
      className="language-select"
      name={name}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "en" || next === "hr") onValueChange?.(next);
      }}
      options={(["en", "hr"] as const).map((locale) => {
        const title = t(locale === "en" ? "common.english" : "common.croatian");
        return {
          value: locale,
          text: title,
          label: (
            <span className="language-option">
              <Image
                src={`/flags/${locale === "en" ? "gb" : "hr"}.svg`}
                width={24}
                height={18}
                alt=""
                aria-hidden="true"
                unoptimized
              />
              <span>{title}</span>
            </span>
          ),
        };
      })}
    />
  );
}
