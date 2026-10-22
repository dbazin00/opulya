ALTER TABLE "User"
  ADD COLUMN "termsVersion" VARCHAR(32),
  ADD COLUMN "termsAcceptedAt" TIMESTAMPTZ(6);

ALTER TABLE "User" ADD CONSTRAINT "User_terms_acceptance_check" CHECK (
  ("termsVersion" IS NULL AND "termsAcceptedAt" IS NULL)
  OR ("termsVersion" IS NOT NULL AND length(trim("termsVersion")) > 0 AND "termsAcceptedAt" IS NOT NULL)
);
