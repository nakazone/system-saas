-- Idiomas da interface: idioma de cada usuário e as edições do Master (termos e frases).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "uiLocale" TEXT;

CREATE TABLE IF NOT EXISTS "I18nTerm" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "locale" TEXT NOT NULL,
  "find" TEXT NOT NULL,
  "replace" TEXT NOT NULL,
  "findPlural" TEXT,
  "replacePlural" TEXT,
  "matchCase" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "note" TEXT,
  "updatedById" UUID,
  "updatedByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "I18nTerm_locale_idx" ON "I18nTerm"("locale");

CREATE TABLE IF NOT EXISTS "I18nPhrase" (
  "source" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "custom" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" UUID,
  "updatedByName" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "I18nPhrase_pkey" PRIMARY KEY ("source", "locale")
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "I18nTerm" TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "I18nPhrase" TO app_user;
  END IF;
END $$;
