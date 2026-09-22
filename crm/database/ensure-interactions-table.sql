-- Garante que a tabela interactions existe e aceita os tipos usados no CRM.
-- Execute uma vez: mysql ... < ensure-interactions-table.sql
-- Ou via Node: node database/run-ensure-interactions.js

CREATE TABLE IF NOT EXISTS `interactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `type` varchar(50) NOT NULL COMMENT 'call, whatsapp, email, visit, meeting',
  `subject` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Se a tabela já existir com type ENUM, altere para VARCHAR para aceitar 'meeting':
-- ALTER TABLE interactions MODIFY type VARCHAR(50) NOT NULL;
