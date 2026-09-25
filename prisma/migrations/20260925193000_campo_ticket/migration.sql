-- Campo ticket: field status + checklist/photos on WorkOrder

ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "fieldStatus" TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "campoAttention" TEXT;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "campoChecklist" JSONB;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "campoPhotos" JSONB;
ALTER TABLE "WorkOrder" ADD COLUMN IF NOT EXISTS "campoProblemNote" TEXT;

CREATE INDEX IF NOT EXISTS "WorkOrder_organizationId_fieldStatus_idx"
  ON "WorkOrder"("organizationId", "fieldStatus");
