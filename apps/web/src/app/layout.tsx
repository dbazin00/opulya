import { cookies, headers } from "next/headers";
import { preferredLocale, resolveLocale } from "@opulya/shared";
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
  const preference = (await cookies()).get("OPULYA_LOCALE")?.value;
  const locale = preference
    ? resolveLocale(preference)
    : preferredLocale((await headers()).get("accept-language"));
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
