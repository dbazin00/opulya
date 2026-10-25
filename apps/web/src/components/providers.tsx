"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { preload } from "react-dom";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resolveLocale, type Locale } from "@opulya/shared";
import { messages } from "@/i18n/messages";
import type { User } from "@/lib/types";
import { ThemeProvider, type Theme } from "./theme-provider";
import spinnerLogo from "../../public/opulya-spinner.webp";
const UserContext = createContext<User | null>(null);
export const useUser = () => useContext(UserContext)!;
// Reuse the server catalogue so ICU version differences cannot change hydrated options.
const CurrencyContext = createContext<readonly string[]>([]);
export const useCurrencies = () => useContext(CurrencyContext);
export function Providers({
  locale,
  theme,
  currencies,
  children,
}: {
  locale: Locale;
  theme: Theme;
  currencies: readonly string[];
  children: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <ThemeProvider initialTheme={theme}>
      <CurrencyContext.Provider value={currencies}>
        <QueryClientProvider client={client}>
          <NextIntlClientProvider
            locale={locale}
            messages={messages[locale]}
            timeZone="Europe/Zagreb"
          >
            {children}
          </NextIntlClientProvider>
        </QueryClientProvider>
      </CurrencyContext.Provider>
    </ThemeProvider>
  );
}
export function UserProvider({
  user,
  children,
}: {
  user: User;
  children: ReactNode;
}) {
  preload(spinnerLogo.src, { as: "image", fetchPriority: "low" });
  const locale = resolveLocale(user.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <UserContext.Provider value={user}>
      <NextIntlClientProvider
        locale={locale}
        messages={messages[locale]}
        timeZone={user.timeZone}
      >
        {children}
      </NextIntlClientProvider>
    </UserContext.Provider>
  );
}
