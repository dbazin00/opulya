import { cookies } from "next/headers";
import { resolveLocale } from "@opulya/shared";
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
  const locale = resolveLocale(preference);
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
