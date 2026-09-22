-- Importação PDF (Invoice2Go, etc.). Executar só se `pdf_path` ainda não existir em `quotes`.
-- Se der erro "Duplicate column", ignore.
ALTER TABLE `quotes`
  ADD COLUMN `pdf_path` VARCHAR(500) NULL DEFAULT NULL;
