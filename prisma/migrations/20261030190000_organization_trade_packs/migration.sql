-- Trade Packs (Phase 0): which trades a company runs. Every existing company keeps the
-- Hardwood pack, so nothing changes for users.
ALTER TABLE "Organization" ADD COLUMN "tradePacks" TEXT[] NOT NULL DEFAULT ARRAY['hardwood']::TEXT[];
