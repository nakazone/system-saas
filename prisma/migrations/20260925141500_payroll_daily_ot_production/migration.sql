-- Payroll: production rate on employees; hour bank diária + extras + sqft
ALTER TABLE "PayrollEmployee" ADD COLUMN IF NOT EXISTS "productionRate" DECIMAL(12,4) NOT NULL DEFAULT 0;

ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "daysWorked" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0;
ALTER TABLE "PayrollHourBankEntry" ADD COLUMN IF NOT EXISTS "sqft" DECIMAL(12,2);
