import { cookies } from "next/headers";
import { resolveLocale } from "@opulya/shared";
import { messages } from "@/i18n/messages";
import { LandingPage } from "@/components/landing-page";

export async function generateMetadata() {
  const preference = (await cookies()).get("OPULYA_LOCALE")?.value;
  const locale = resolveLocale(preference);
  const text = messages[locale].landing;
  return { title: text.metaTitle, description: text.metaDescription };
}

export default function Page() {
  return <LandingPage />;
}
