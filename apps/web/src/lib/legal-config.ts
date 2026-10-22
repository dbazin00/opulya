import { signupSchema } from "@opulya/shared";

export type LegalDetails = {
  operator: string;
  email: string;
  retention: string;
  transfers: string;
  draft: boolean;
};

export function legalDetails(
  environment: Record<string, string | undefined>,
): LegalDetails {
  const operator = environment.LEGAL_OPERATOR_NAME?.trim().slice(0, 200) ?? "";
  const parsedEmail = signupSchema.shape.email.safeParse(
    environment.LEGAL_CONTACT_EMAIL,
  );
  const email = parsedEmail.success ? parsedEmail.data : "";
  const retention =
    environment.LEGAL_RETENTION_DETAILS?.trim().slice(0, 3000) ?? "";
  const transfers =
    environment.LEGAL_TRANSFER_DETAILS?.trim().slice(0, 3000) ?? "";
  return {
    operator,
    email,
    retention,
    transfers,
    draft:
      environment.LEGAL_NOTICE_REVIEWED !== "true" ||
      !operator ||
      !email ||
      !retention ||
      !transfers,
  };
}
