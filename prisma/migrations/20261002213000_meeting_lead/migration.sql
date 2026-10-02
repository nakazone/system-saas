-- Lead visits live in Lead.metadata.visits and create a Meeting for the schedule.
-- Link the meeting back to its lead so the agenda can show the client and open the lead.
ALTER TABLE "Meeting" ADD COLUMN "leadId" UUID;
CREATE INDEX "Meeting_leadId_idx" ON "Meeting"("leadId");
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from existing visits.
UPDATE "Meeting" m
SET "leadId" = l."id"
FROM "Lead" l, jsonb_array_elements(
  CASE WHEN jsonb_typeof(l."metadata"->'visits') = 'array' THEN l."metadata"->'visits' ELSE '[]'::jsonb END
) v
WHERE v->>'meeting_id' = m."id"::text
  AND l."organizationId" = m."organizationId"
  AND m."leadId" IS NULL;
