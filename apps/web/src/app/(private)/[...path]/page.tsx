import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  if (
    ![
      "dashboard",
      "accounts",
      "transactions",
      "analytics",
      "budgets",
      "investments",
      "assets",
      "categories",
      "settings",
    ].includes(path[0]!) ||
    path.length > (path[0] === "accounts" ? 2 : 1)
  )
    notFound();
  return <Workspace view={path[0]!} accountId={path[1]} />;
}
