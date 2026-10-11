import { AuthForm } from "@/components/auth-form";
export const metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <AuthForm signup={false} verify />;
}
