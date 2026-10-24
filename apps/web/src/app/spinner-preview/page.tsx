import { notFound } from "next/navigation";
import { OpulyaSpinnerPreview } from "@/components/opulya-spinner-preview";

export const metadata = {
  title: "Logo spinner preview | Opulya",
  robots: { index: false, follow: false },
};

export default function SpinnerPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OpulyaSpinnerPreview />;
}
