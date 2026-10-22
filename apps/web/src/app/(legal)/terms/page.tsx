import { LegalPage } from "@/components/legal-page";
import { legalDetails } from "@/lib/legal-config";

export default function Page() {
  return <LegalPage policy="terms" details={legalDetails(process.env)} />;
}
