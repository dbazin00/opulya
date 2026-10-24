"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
const ThemeContext = createContext<{
  theme: Theme;
  setTheme: (theme: Theme) => void;
} | null>(null);

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [theme, updateTheme] = useState(initialTheme);
  const setTheme = (next: Theme) => {
    updateTheme(next);
    document.documentElement.dataset.theme = next;
    document.cookie = `OPULYA_THEME=${next}; Path=/; SameSite=Lax; Max-Age=31536000${location.protocol === "https:" ? "; Secure" : ""}`;
  };
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("ThemeProvider is required");
  return value;
}
