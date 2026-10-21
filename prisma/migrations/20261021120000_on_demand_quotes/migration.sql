-- Only disposable market prices and obsolete scheduler state are removed.
-- Accounts, assets, instrument identities and investment history are preserved.
DROP TABLE "LatestPrice";
DROP TYPE "PriceKind";
ALTER TABLE "InstrumentMapping"
  DROP COLUMN "lastAttemptAt",
  DROP COLUMN "lastSuccessAt",
  DROP COLUMN "error",
  DROP COLUMN "currentRequestedAt";
DELETE FROM "InstrumentDirectoryCache" WHERE id LIKE 'yahoo:v1:%';
DELETE FROM "MarketJob" WHERE id = 'latest-prices';
