ALTER TABLE "User" ADD COLUMN "processingRestrictedAt" TIMESTAMPTZ(6);
CREATE INDEX "User_emailVerifiedAt_createdAt_idx" ON "User"("emailVerifiedAt", "createdAt");
