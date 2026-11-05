-- Indexes for the newest-first lists on first screens: leads (/api/leads), the funnel's quote
-- summary (/api/leads/quote-engagement-summary) and the ObraCam photo feed (/api/job-media/board).

CREATE INDEX IF NOT EXISTS "Lead_organizationId_createdAt_idx" ON "Lead"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "Quote_organizationId_createdAt_idx" ON "Quote"("organizationId", "createdAt");

CREATE INDEX IF NOT EXISTS "JobMedia_organizationId_type_createdAt_idx" ON "JobMedia"("organizationId", "type", "createdAt");
