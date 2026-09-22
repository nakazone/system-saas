-- Endereço completo na qualificação (executar uma vez na BD existente)
ALTER TABLE lead_qualification ADD COLUMN address_street VARCHAR(255) DEFAULT NULL COMMENT 'Rua e número';
ALTER TABLE lead_qualification ADD COLUMN address_line2 VARCHAR(255) DEFAULT NULL COMMENT 'Complemento';
ALTER TABLE lead_qualification ADD COLUMN address_city VARCHAR(120) DEFAULT NULL COMMENT 'Cidade';
ALTER TABLE lead_qualification ADD COLUMN address_state VARCHAR(50) DEFAULT NULL COMMENT 'Estado';
ALTER TABLE lead_qualification ADD COLUMN address_zip VARCHAR(20) DEFAULT NULL COMMENT 'CEP / ZIP';
