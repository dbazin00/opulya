import { cookies } from "next/headers";
import { currencies, resolveLocale } from "@opulya/shared";
import { Providers } from "@/components/providers";
import "./globals.css";
export const metadata = {
  title: "Opulya",
  description: "Opulya",
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const preference = store.get("OPULYA_LOCALE")?.value;
  const locale = resolveLocale(preference);
  const theme = store.get("OPULYA_THEME")?.value === "dark" ? "dark" : "light";
  return (
    <html lang={locale} data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <Providers locale={locale} theme={theme} currencies={currencies}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
