import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal-config";

export default function Page() {
  return <LegalPage policy="privacy" details={legalDetails(process.env)} />;
}
