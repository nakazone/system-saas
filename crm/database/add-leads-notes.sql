-- Add notes to leads table (if missing)
ALTER TABLE leads ADD COLUMN notes TEXT DEFAULT NULL COMMENT 'Notas gerais';
