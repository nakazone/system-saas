-- Production pay by item (Tile: floor SF, wall SF, shower pan, niche…).
-- PieceRate: the company rate per item (employeeId NULL) and, optionally, a different rate for one employee.
-- The day's quantities per job and the rates used are kept on the day and on its payroll line.
CREATE TABLE "PieceRate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organizationId" UUID NOT NULL,
    "employeeId" UUID,
    "itemKey" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PieceRate_pkey" PRIMARY KEY ("id")
);

-- One company rate per item, and one rate per employee per item.
CREATE UNIQUE INDEX "PieceRate_company_item_key" ON "PieceRate"("organizationId", "itemKey") WHERE "employeeId" IS NULL;
CREATE UNIQUE INDEX "PieceRate_employee_item_key" ON "PieceRate"("organizationId", "employeeId", "itemKey") WHERE "employeeId" IS NOT NULL;
CREATE INDEX "PieceRate_organizationId_idx" ON "PieceRate"("organizationId");

ALTER TABLE "PieceRate" ADD CONSTRAINT "PieceRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PieceRate" ADD CONSTRAINT "PieceRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "PayrollEmployee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PieceRate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PieceRate" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PieceRate"
  USING ("organizationId"::text = current_setting('app.current_tenant_id', true))
  WITH CHECK ("organizationId"::text = current_setting('app.current_tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "PieceRate" TO app_user;

-- Quantities per item on each job of the day: { "floor_sf": 120, "niche": 1 }.
ALTER TABLE "CampoShiftJob" ADD COLUMN "pieces" JSONB;
-- What the day paid per item, with the rates used: [{ key, label, unit, qty, rate, amount }].
ALTER TABLE "CampoShift" ADD COLUMN "pieces" JSONB;
ALTER TABLE "PayrollTimesheet" ADD COLUMN "pieces" JSONB;
