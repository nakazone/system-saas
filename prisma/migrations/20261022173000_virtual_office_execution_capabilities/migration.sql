-- Upgrade only untouched default profiles; preserve any capabilities users configured.
UPDATE "VirtualAgent"
SET "capabilities" = ARRAY['jobs.view', 'jobs.manage', 'schedule.view', 'schedule.manage', 'crews.view']::TEXT[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'rafael'
  AND "capabilities" = ARRAY['jobs.view', 'schedule.view', 'crews.view']::TEXT[];

UPDATE "VirtualAgent"
SET "capabilities" = ARRAY['invoices.view', 'invoices.manage', 'payments.view', 'payments.manage']::TEXT[],
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'marina'
  AND "capabilities" = ARRAY['invoices.view', 'payments.view']::TEXT[];
