import { AuthForm } from "@/components/auth-form";
import { legalDetails } from "@/lib/legal-config";
import { registrationAllowed } from "@opulya/shared";
export default function Page() {
  return (
    <AuthForm
      signup
      legalDraft={legalDetails(process.env).draft}
      registrationClosed={!registrationAllowed(process.env)}
    />
  );
}
