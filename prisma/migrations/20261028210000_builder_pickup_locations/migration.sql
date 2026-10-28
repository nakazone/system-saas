-- Builder pickup locations (supplier yards / warehouses), matched to work orders by alias.
CREATE TABLE "BuilderPickupLocation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "builderAccountId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phone" TEXT,
    "hours" TEXT,
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BuilderPickupLocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BuilderPickupLocation_builderAccountId_idx" ON "BuilderPickupLocation"("builderAccountId");
ALTER TABLE "BuilderPickupLocation" ADD CONSTRAINT "BuilderPickupLocation_builderAccountId_fkey"
  FOREIGN KEY ("builderAccountId") REFERENCES "BuilderAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Website on the builder account (settings).
ALTER TABLE "BuilderAccount" ADD COLUMN IF NOT EXISTS "website" TEXT;

GRANT SELECT, INSERT, UPDATE, DELETE ON "BuilderPickupLocation" TO app_user;
