-- WorkOrder sector (installation | sand_finish) + link to related job (Lixa → Instalação).
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "sector" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "relatedWorkOrderId" UUID;

CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_sector_idx" ON "WorkOrder"("organizationId", "sector");
CREATE INDEX IF NOT EXISTS "WorkOrder_relatedWorkOrderId_idx" ON "WorkOrder"("relatedWorkOrderId");

DO $$ BEGIN
  ALTER TABLE "WorkOrder"
    ADD CONSTRAINT "WorkOrder_relatedWorkOrderId_fkey"
    FOREIGN KEY ("relatedWorkOrderId") REFERENCES "WorkOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
