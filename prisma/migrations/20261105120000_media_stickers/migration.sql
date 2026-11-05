-- ObraCam stickers: photo labels each company defines (Samples, Delivery, Scan...).
CREATE TABLE "MediaSticker" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MediaSticker_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MediaSticker_organizationId_idx" ON "MediaSticker"("organizationId");
CREATE UNIQUE INDEX "MediaSticker_organizationId_key_key" ON "MediaSticker"("organizationId", "key");
ALTER TABLE "MediaSticker" ADD CONSTRAINT "MediaSticker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MediaSticker" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MediaSticker" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MediaSticker"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

-- Stickers on each photo. Defaults (Samples, Delivery, Scan) and the Samples backfill for existing stain
-- sample photos happen in the app, inside each company's tenant transaction, the first time stickers load.
ALTER TABLE "JobMedia" ADD COLUMN "stickerIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
