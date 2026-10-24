"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "./theme-provider";
import { IconButton } from "./ui";

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("settings");
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <IconButton
      className={className}
      label={t(dark ? "switchToLight" : "switchToDark")}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun size={19} aria-hidden /> : <Moon size={19} aria-hidden />}
    </IconButton>
  );
}
