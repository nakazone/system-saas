-- Add missing columns to lead_qualification (if table exists but columns are missing)
ALTER TABLE lead_qualification ADD COLUMN decision_maker VARCHAR(255) DEFAULT NULL COMMENT 'Nome do tomador de decisão';
ALTER TABLE lead_qualification ADD COLUMN decision_timeline VARCHAR(100) DEFAULT NULL COMMENT '1 semana, 1 mês, etc.';
ALTER TABLE lead_qualification ADD COLUMN payment_type VARCHAR(50) DEFAULT NULL COMMENT 'cash, financing, insurance';
ALTER TABLE lead_qualification ADD COLUMN score INT(11) DEFAULT NULL COMMENT 'Score de qualificação (0-100)';
ALTER TABLE lead_qualification ADD COLUMN qualification_notes TEXT DEFAULT NULL COMMENT 'Notas da qualificação';
ALTER TABLE lead_qualification ADD COLUMN qualified_by INT(11) DEFAULT NULL COMMENT 'FK users';
ALTER TABLE lead_qualification ADD COLUMN qualified_at TIMESTAMP NULL DEFAULT NULL;
