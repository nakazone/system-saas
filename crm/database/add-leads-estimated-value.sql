-- Add estimated_value to leads table (if missing)
ALTER TABLE leads ADD COLUMN estimated_value DECIMAL(10,2) DEFAULT NULL COMMENT 'Valor estimado do projeto';
