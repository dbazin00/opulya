-- Consolidated initial schema. Baseline existing databases before deployment.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CASH', 'BANK', 'INVESTMENT');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('BUY', 'SELL', 'DIVIDEND', 'FEE', 'DEPOSIT', 'WITHDRAWAL');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('STOCK', 'ETF', 'CRYPTO', 'FUND', 'OTHER');

-- CreateEnum
CREATE TYPE "PriceKind" AS ENUM ('CLOSE', 'QUOTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "emailVerificationTokenHash" TEXT,
    "emailVerificationExpiresAt" TIMESTAMPTZ(6),
    "emailVerificationSentAt" TIMESTAMPTZ(6),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timeZone" TEXT NOT NULL DEFAULT 'Europe/Zagreb',
    "ledgerVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "initialBalance" DECIMAL(24,8) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CategoryType" NOT NULL,
    "name" TEXT,
    "defaultKey" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "sourceAccountId" TEXT,
    "destinationAccountId" TEXT,
    "amount" DECIMAL(24,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "categoryId" TEXT,
    "description" TEXT,
    "visibleInHistory" BOOLEAN NOT NULL DEFAULT true,
    "isOpeningBalance" BOOLEAN NOT NULL DEFAULT false,
    "sourceBalanceAfter" DECIMAL(48,8),
    "destinationBalanceAfter" DECIMAL(48,8),
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "ledgerOrderAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "voidedAt" TIMESTAMPTZ(6),
    "replacesId" TEXT,
    "clientRequestId" TEXT NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL,
    "marketDataIdentifier" TEXT,
    "instrumentId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetType" "AssetType" NOT NULL,
    "exchange" TEXT NOT NULL,
    "mic" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "isin" TEXT,
    "identity" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentMapping" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "mic" TEXT NOT NULL DEFAULT '',
    "currency" VARCHAR(3) NOT NULL,
    "lastAttemptAt" TIMESTAMPTZ(6),
    "lastSuccessAt" TIMESTAMPTZ(6),
    "error" TEXT,
    "currentRequestedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InstrumentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatestPrice" (
    "instrumentId" TEXT NOT NULL,
    "tradingDate" DATE NOT NULL,
    "availableAt" TIMESTAMPTZ(6) NOT NULL,
    "price" DECIMAL(24,8) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
    "kind" "PriceKind" NOT NULL DEFAULT 'CLOSE',
    "marketAt" TIMESTAMPTZ(6),

    CONSTRAINT "LatestPrice_pkey" PRIMARY KEY ("instrumentId")
);

-- CreateTable
CREATE TABLE "MarketQuota" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketQuota_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MarketJob" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "leaseUntil" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "MarketJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentDirectoryCache" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" BYTEA NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InstrumentDirectoryCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "assetId" TEXT,
    "type" "InvestmentType" NOT NULL,
    "quantity" DECIMAL(28,12),
    "pricePerUnit" DECIMAL(24,8),
    "totalAmount" DECIMAL(24,8) NOT NULL,
    "fee" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "balanceAfter" DECIMAL(48,8),
    "currency" VARCHAR(3) NOT NULL,
    "executedAt" TIMESTAMPTZ(6) NOT NULL,
    "ledgerOrderAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "voidedAt" TIMESTAMPTZ(6),
    "clientRequestId" TEXT NOT NULL,
    "fundingTransactionId" TEXT,
    "replacesId" TEXT,

    CONSTRAINT "InvestmentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_emailVerificationTokenHash_key" ON "User"("emailVerificationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_lastSeenAt_idx" ON "Session"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Account_userId_archivedAt_idx" ON "Account"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_id_userId_key" ON "Account"("id", "userId");

-- CreateIndex
CREATE INDEX "Category_userId_parentId_idx" ON "Category"("userId", "parentId");

-- CreateIndex
CREATE INDEX "Category_userId_archivedAt_idx" ON "Category"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_id_userId_key" ON "Category"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_userId_type_defaultKey_key" ON "Category"("userId", "type", "defaultKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_replacesId_key" ON "Transaction"("replacesId");

-- CreateIndex
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_sourceAccountId_occurredAt_idx" ON "Transaction"("sourceAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_destinationAccountId_occurredAt_idx" ON "Transaction"("destinationAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_id_userId_key" ON "Transaction"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_userId_clientRequestId_key" ON "Transaction"("userId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_id_userId_key" ON "Asset"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_userId_symbol_exchange_currency_key" ON "Asset"("userId", "symbol", "exchange", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_identity_key" ON "Instrument"("identity");

-- CreateIndex
CREATE INDEX "Instrument_symbol_idx" ON "Instrument"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentMapping_instrumentId_provider_key" ON "InstrumentMapping"("instrumentId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentMapping_provider_symbol_exchange_mic_currency_key" ON "InstrumentMapping"("provider", "symbol", "exchange", "mic", "currency");

-- CreateIndex
CREATE INDEX "InvestmentTransaction_userId_accountId_executedAt_idx" ON "InvestmentTransaction"("userId", "accountId", "executedAt");

-- CreateIndex
CREATE INDEX "InvestmentTransaction_assetId_idx" ON "InvestmentTransaction"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_id_userId_key" ON "InvestmentTransaction"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_replacesId_userId_key" ON "InvestmentTransaction"("replacesId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_fundingTransactionId_userId_key" ON "InvestmentTransaction"("fundingTransactionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTransaction_userId_clientRequestId_key" ON "InvestmentTransaction"("userId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_userId_fkey" FOREIGN KEY ("parentId", "userId") REFERENCES "Category"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourceAccountId_userId_fkey" FOREIGN KEY ("sourceAccountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_destinationAccountId_userId_fkey" FOREIGN KEY ("destinationAccountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_userId_fkey" FOREIGN KEY ("categoryId", "userId") REFERENCES "Category"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMapping" ADD CONSTRAINT "InstrumentMapping_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LatestPrice" ADD CONSTRAINT "LatestPrice_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_accountId_userId_fkey" FOREIGN KEY ("accountId", "userId") REFERENCES "Account"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_assetId_userId_fkey" FOREIGN KEY ("assetId", "userId") REFERENCES "Asset"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_fundingTransactionId_userId_fkey" FOREIGN KEY ("fundingTransactionId", "userId") REFERENCES "Transaction"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_replacesId_userId_fkey" FOREIGN KEY ("replacesId", "userId") REFERENCES "InvestmentTransaction"("id", "userId") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Application invariants not represented by the Prisma datamodel.
ALTER TABLE "LatestPrice" ADD CONSTRAINT "LatestPrice_price_positive"
  CHECK ("price" > 0);
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_hidden_balance_only"
  CHECK ("visibleInHistory" OR "type" = 'ADJUSTMENT');
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_opening_balance_only"
  CHECK (NOT "isOpeningBalance" OR ("type" = 'ADJUSTMENT' AND "visibleInHistory"));
ALTER TABLE "InvestmentTransaction" ADD CONSTRAINT "InvestmentTransaction_no_self_correction"
  CHECK ("replacesId" IS NULL OR "replacesId" <> "id");

COMMIT;
