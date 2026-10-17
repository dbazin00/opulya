CREATE TABLE "EmailQuota" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "EmailQuota_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "EmailQuota_expiresAt_idx" ON "EmailQuota"("expiresAt");
