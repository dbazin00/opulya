ALTER TABLE "Budget" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "Budget" ADD COLUMN "assetId" TEXT;

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_target_check"
  CHECK (("categoryId" IS NOT NULL) <> ("assetId" IS NOT NULL));
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_assetId_userId_fkey"
  FOREIGN KEY ("assetId", "userId") REFERENCES "Asset"("id", "userId")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "Budget_userId_assetId_currency_month_scope_key"
  ON "Budget"("userId", "assetId", "currency", "month", "scope");
