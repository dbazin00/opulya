CREATE TYPE "BudgetScope" AS ENUM ('RECURRING', 'MONTH');

CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "scope" "BudgetScope" NOT NULL,
    "amount" DECIMAL(24,8),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Budget_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0),
    CONSTRAINT "Budget_month_check" CHECK ("month" ~ '^[1-9][0-9]{3}-(0[1-9]|1[0-2])$')
);

CREATE UNIQUE INDEX "Budget_userId_categoryId_currency_month_scope_key" ON "Budget"("userId", "categoryId", "currency", "month", "scope");
CREATE INDEX "Budget_userId_currency_month_idx" ON "Budget"("userId", "currency", "month");
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_userId_fkey" FOREIGN KEY ("categoryId", "userId") REFERENCES "Category"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;
