-- ============================================
-- Senior Floors - Estimate Engine Schema (Simplified)
-- Execute via: node database/run-schema-estimates-simple.js
-- ============================================

-- ============================================
-- 1. ESTIMATES (Tabela principal de estimativas)
-- ============================================
CREATE TABLE IF NOT EXISTS `estimates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL COMMENT 'FK projects',
  `lead_id` int(11) DEFAULT NULL COMMENT 'FK leads (opcional)',
  `estimate_number` varchar(50) DEFAULT NULL COMMENT 'Número da estimativa (ex: EST-2024-001)',
  `version` int(11) DEFAULT 1 COMMENT 'Versão da estimativa',
  `material_cost_total` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo total de materiais',
  `labor_cost_total` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo total de mão de obra',
  `equipment_cost_total` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo total de equipamentos',
  `direct_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo direto (material + labor + equipment)',
  `overhead_percentage` decimal(5,2) DEFAULT 0.00 COMMENT 'Percentual de overhead',
  `overhead_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Valor de overhead',
  `profit_margin_percentage` decimal(5,2) DEFAULT 0.00 COMMENT 'Margem de lucro percentual',
  `profit_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Valor de lucro',
  `final_price` decimal(10,2) DEFAULT 0.00 COMMENT 'Preço final',
  `status` varchar(50) DEFAULT 'draft' COMMENT 'draft | sent | viewed | accepted | declined | expired',
  `expiration_date` date DEFAULT NULL COMMENT 'Data de expiração',
  `sent_at` datetime DEFAULT NULL COMMENT 'Data de envio',
  `viewed_at` datetime DEFAULT NULL COMMENT 'Data de visualização pelo cliente',
  `accepted_at` datetime DEFAULT NULL COMMENT 'Data de aceitação',
  `declined_at` datetime DEFAULT NULL COMMENT 'Data de recusa',
  `notes` text DEFAULT NULL COMMENT 'Notas internas',
  `client_notes` text DEFAULT NULL COMMENT 'Notas visíveis para o cliente',
  `payment_schedule` json DEFAULT NULL COMMENT 'Cronograma de pagamento',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users - quem criou',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `estimate_number` (`estimate_number`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_status` (`status`),
  KEY `idx_expiration_date` (`expiration_date`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_estimates_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_estimates_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_estimates_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. ESTIMATE ITEMS (Itens da estimativa)
-- ============================================
CREATE TABLE IF NOT EXISTS `estimate_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL COMMENT 'FK estimates',
  `category` varchar(50) NOT NULL COMMENT 'material | labor | equipment | overhead | profit',
  `name` varchar(255) NOT NULL COMMENT 'Nome do item',
  `description` text DEFAULT NULL COMMENT 'Descrição detalhada',
  `unit_type` varchar(50) NOT NULL COMMENT 'sqft | linear_ft | unit | stairs | fixed',
  `quantity` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Quantidade',
  `unit_cost` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Custo unitário',
  `total_cost` decimal(10,2) NOT NULL DEFAULT 0.00 COMMENT 'Custo total (quantity * unit_cost)',
  `is_auto_added` tinyint(1) DEFAULT 0 COMMENT '1=adicionado automaticamente por regras',
  `sort_order` int(11) DEFAULT 0 COMMENT 'Ordem de exibição',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_estimate_id` (`estimate_id`),
  KEY `idx_category` (`category`),
  KEY `idx_sort_order` (`sort_order`),
  CONSTRAINT `fk_estimate_items_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. ESTIMATE RULES (Regras inteligentes)
-- ============================================
CREATE TABLE IF NOT EXISTS `estimate_rules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(100) NOT NULL COMMENT 'Nome da regra',
  `rule_type` varchar(50) NOT NULL COMMENT 'waste_percentage | auto_item | condition',
  `condition_json` json DEFAULT NULL COMMENT 'Condições em JSON',
  `action_json` json DEFAULT NULL COMMENT 'Ações em JSON',
  `is_active` tinyint(1) DEFAULT 1,
  `priority` int(11) DEFAULT 0 COMMENT 'Prioridade de execução',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rule_type` (`rule_type`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inserir regras padrão
INSERT IGNORE INTO `estimate_rules` (`rule_name`, `rule_type`, `condition_json`, `action_json`, `priority`) VALUES
('Waste - Hardwood', 'waste_percentage', '{"flooring_type": "hardwood"}', '{"waste_percentage": 10}', 1),
('Waste - Engineered', 'waste_percentage', '{"flooring_type": "engineered"}', '{"waste_percentage": 8}', 2),
('Waste - LVP', 'waste_percentage', '{"flooring_type": "lvp"}', '{"waste_percentage": 5}', 3),
('Waste - Tile', 'waste_percentage', '{"flooring_type": "tile"}', '{"waste_percentage": 12}', 4),
('Moisture Barrier - Hardwood on Concrete', 'auto_item', '{"flooring_type": "hardwood", "subfloor_type": "concrete"}', '{"category": "material", "name": "Moisture Barrier", "unit_type": "sqft", "unit_cost": 0.50}', 5),
('Leveling - Major Condition', 'auto_item', '{"level_condition": "major"}', '{"category": "material", "name": "Leveling Compound", "unit_type": "sqft", "unit_cost": 1.25}', 6),
('Stair Labor', 'auto_item', '{"stairs_count": {"gt": 0}}', '{"category": "labor", "name": "Stair Installation", "unit_type": "stairs", "unit_cost": 150.00}', 7);

-- ============================================
-- 4. ESTIMATE ANALYTICS (Tabela para analytics)
-- ============================================
CREATE TABLE IF NOT EXISTS `estimate_analytics` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `estimate_id` int(11) NOT NULL COMMENT 'FK estimates',
  `project_type` varchar(50) DEFAULT NULL,
  `flooring_type` varchar(50) DEFAULT NULL,
  `margin_percentage` decimal(5,2) DEFAULT NULL,
  `margin_amount` decimal(10,2) DEFAULT NULL,
  `acceptance_status` varchar(50) DEFAULT NULL COMMENT 'accepted | declined | pending',
  `time_to_accept` int(11) DEFAULT NULL COMMENT 'Tempo em horas até aceitação',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_estimate_id` (`estimate_id`),
  KEY `idx_project_type` (`project_type`),
  KEY `idx_flooring_type` (`flooring_type`),
  CONSTRAINT `fk_estimate_analytics_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
