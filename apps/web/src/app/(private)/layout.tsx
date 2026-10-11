import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserProvider } from "@/components/providers";
import { Shell } from "@/components/shell";
import type { User } from "@/lib/types";
export default async function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const response = await fetch(
    `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"}/api/auth/me`,
    { headers: { Cookie: (await cookies()).toString() }, cache: "no-store" },
  );
  if (response.status === 401) redirect("/login");
  if (!response.ok) throw new Error("NETWORK_ERROR");
  const user = (await response.json()) as User;
  return (
    <UserProvider user={user}>
      <Shell>{children}</Shell>
    </UserProvider>
  );
}
