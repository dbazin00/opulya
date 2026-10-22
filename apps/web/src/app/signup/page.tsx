import { AuthForm } from "@/components/auth-form";
import { legalDetails } from "@/lib/legal-config";
export default function Page() {
  return <AuthForm signup legalDraft={legalDetails(process.env).draft} />;
}
