-- ============================================
-- Senior Floors CRM - Schema Completo
-- Sistema completo de CRM para construção/pisos/reformas
-- Pipeline completo: Lead → Qualificação → Visita → Medição → Proposta → Contrato → Produção
-- ============================================

-- ============================================
-- 1. USUÁRIOS (já existe, mas vamos garantir)
-- ============================================
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL COMMENT 'hash bcrypt',
  `role` varchar(50) DEFAULT 'user' COMMENT 'admin, manager, sales, operational',
  `is_active` tinyint(1) DEFAULT 1,
  `phone` varchar(50) DEFAULT NULL,
  `avatar` varchar(500) DEFAULT NULL,
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. ESTÁGIOS DO PIPELINE
-- ============================================
CREATE TABLE IF NOT EXISTS `pipeline_stages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT 'Nome do estágio',
  `slug` varchar(50) NOT NULL COMMENT 'Slug único (ex: lead_received)',
  `description` text DEFAULT NULL,
  `order_num` int(11) DEFAULT 0 COMMENT 'Ordem de exibição',
  `color` varchar(20) DEFAULT '#3498db' COMMENT 'Cor do estágio (hex)',
  `sla_hours` int(11) DEFAULT NULL COMMENT 'SLA em horas para sair deste estágio',
  `required_actions` json DEFAULT NULL COMMENT 'Ações obrigatórias para avançar',
  `required_fields` json DEFAULT NULL COMMENT 'Campos obrigatórios para avançar',
  `is_closed` tinyint(1) DEFAULT 0 COMMENT '1=estágio final (ganhou/perdeu)',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_order` (`order_num`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. LEADS (atualizado)
-- ============================================
CREATE TABLE IF NOT EXISTS `leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `email` varchar(255) NOT NULL,
  `zipcode` varchar(10) NOT NULL,
  `address` varchar(500) DEFAULT NULL COMMENT 'Endereço completo (linha única)',
  `message` text DEFAULT NULL,
  `source` varchar(100) DEFAULT NULL COMMENT 'LP-Hero, LP-Contact, Referral, etc.',
  `form_type` varchar(50) DEFAULT NULL,
  `status` varchar(50) DEFAULT 'new_lead' COMMENT 'Status atual do lead (slug do pipeline)',
  `priority` varchar(50) DEFAULT 'medium' COMMENT 'low, medium, high',
  `ip_address` varchar(45) DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL COMMENT 'FK users - vendedor responsável',
  `pipeline_stage_id` int(11) DEFAULT NULL COMMENT 'FK pipeline_stages',
  `estimated_value` decimal(10,2) DEFAULT NULL COMMENT 'Valor estimado do projeto',
  `estimated_date` date DEFAULT NULL COMMENT 'Data estimada do projeto',
  `notes` text DEFAULT NULL COMMENT 'Notas gerais',
  `converted_at` timestamp NULL DEFAULT NULL COMMENT 'Data de conversão',
  `lost_reason` varchar(255) DEFAULT NULL COMMENT 'Motivo da perda',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_priority` (`priority`),
  KEY `idx_owner_id` (`owner_id`),
  KEY `idx_pipeline_stage_id` (`pipeline_stage_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_source` (`source`),
  CONSTRAINT `fk_leads_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_leads_pipeline_stage` FOREIGN KEY (`pipeline_stage_id`) REFERENCES `pipeline_stages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. QUALIFICAÇÃO DO LEAD
-- ============================================
CREATE TABLE IF NOT EXISTS `lead_qualification` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `property_type` varchar(100) DEFAULT NULL COMMENT 'Casa, Apartamento, Comercial, etc.',
  `service_type` varchar(100) DEFAULT NULL COMMENT 'Instalação, Reparo, Renovação, etc.',
  `estimated_area` decimal(10,2) DEFAULT NULL COMMENT 'Área estimada em sqft',
  `estimated_budget` decimal(10,2) DEFAULT NULL COMMENT 'Orçamento estimado',
  `urgency` varchar(50) DEFAULT NULL COMMENT 'low, medium, high, urgent',
  `decision_maker` varchar(255) DEFAULT NULL COMMENT 'Nome do tomador de decisão',
  `decision_timeline` varchar(100) DEFAULT NULL COMMENT '1 semana, 1 mês, etc.',
  `payment_type` varchar(50) DEFAULT NULL COMMENT 'cash, financing, insurance',
  `score` int(11) DEFAULT NULL COMMENT 'Score de qualificação (0-100)',
  `qualification_notes` text DEFAULT NULL COMMENT 'Notas da qualificação',
  `address_street` varchar(255) DEFAULT NULL COMMENT 'Rua e número (endereço do serviço)',
  `address_line2` varchar(255) DEFAULT NULL COMMENT 'Complemento (apto, suite)',
  `address_city` varchar(120) DEFAULT NULL COMMENT 'Cidade',
  `address_state` varchar(50) DEFAULT NULL COMMENT 'Estado (ex.: FL)',
  `address_zip` varchar(20) DEFAULT NULL COMMENT 'CEP / ZIP',
  `qualified_by` int(11) DEFAULT NULL COMMENT 'FK users - quem qualificou',
  `qualified_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `lead_id` (`lead_id`),
  KEY `idx_score` (`score`),
  KEY `idx_qualified_by` (`qualified_by`),
  CONSTRAINT `fk_qualification_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qualification_user` FOREIGN KEY (`qualified_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. INTERAÇÕES (chamadas, emails, WhatsApp, visitas)
-- ============================================
CREATE TABLE IF NOT EXISTS `interactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `user_id` int(11) DEFAULT NULL COMMENT 'FK users - quem fez a interação',
  `type` varchar(50) NOT NULL COMMENT 'call, whatsapp, email, visit, meeting',
  `direction` varchar(20) DEFAULT NULL COMMENT 'inbound, outbound',
  `subject` varchar(255) DEFAULT NULL COMMENT 'Assunto (para emails)',
  `notes` text DEFAULT NULL COMMENT 'Notas da interação',
  `duration_minutes` int(11) DEFAULT NULL COMMENT 'Duração em minutos (para calls)',
  `outcome` varchar(100) DEFAULT NULL COMMENT 'successful, no_answer, busy, etc.',
  `next_followup_date` timestamp NULL DEFAULT NULL COMMENT 'Próximo follow-up',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_next_followup` (`next_followup_date`),
  CONSTRAINT `fk_interactions_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_interactions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. VISITAS
-- ============================================
CREATE TABLE IF NOT EXISTS `visits` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `scheduled_at` timestamp NOT NULL COMMENT 'Data/hora agendada',
  `address` varchar(500) NOT NULL COMMENT 'Endereço completo',
  `address_line2` varchar(255) DEFAULT NULL COMMENT 'Complemento',
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(50) DEFAULT NULL COMMENT 'Estado (ex: CO, CA)',
  `zipcode` varchar(10) DEFAULT NULL,
  `assigned_to` int(11) DEFAULT NULL COMMENT 'FK users - responsável pela visita',
  `status` varchar(50) DEFAULT 'scheduled' COMMENT 'scheduled, confirmed, completed, cancelled, no_show',
  `confirmation_sent_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi enviada confirmação',
  `confirmed_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi confirmada',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi realizada',
  `notes` text DEFAULT NULL COMMENT 'Notas da visita',
  `google_calendar_event_id` varchar(255) DEFAULT NULL COMMENT 'Google Calendar event id',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_assigned_to` (`assigned_to`),
  KEY `idx_scheduled_at` (`scheduled_at`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_visits_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_visits_user` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. MEDIÇÕES (realizadas durante visitas)
-- ============================================
CREATE TABLE IF NOT EXISTS `measurements` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `visit_id` int(11) NOT NULL COMMENT 'FK visits',
  `lead_id` int(11) NOT NULL COMMENT 'FK leads (para facilitar queries)',
  `final_area` decimal(10,2) DEFAULT NULL COMMENT 'Área final medida em sqft',
  `rooms_count` int(11) DEFAULT NULL COMMENT 'Número de cômodos',
  `technical_notes` text DEFAULT NULL COMMENT 'Notas técnicas',
  `photos` json DEFAULT NULL COMMENT 'Array de URLs das fotos',
  `risks` text DEFAULT NULL COMMENT 'Riscos identificados',
  `subfloor_condition` varchar(100) DEFAULT NULL COMMENT 'Condição do piso base',
  `preparation_needed` tinyint(1) DEFAULT 0 COMMENT 'Precisa preparação?',
  `preparation_notes` text DEFAULT NULL COMMENT 'Notas sobre preparação',
  `measured_by` int(11) DEFAULT NULL COMMENT 'FK users - quem mediu',
  `measured_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi medida',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `visit_id` (`visit_id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_measured_by` (`measured_by`),
  CONSTRAINT `fk_measurements_visit` FOREIGN KEY (`visit_id`) REFERENCES `visits` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_measurements_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_measurements_user` FOREIGN KEY (`measured_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 8. PROPOSTAS
-- ============================================
CREATE TABLE IF NOT EXISTS `proposals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `version` int(11) DEFAULT 1 COMMENT 'Versão da proposta',
  `proposal_number` varchar(50) DEFAULT NULL COMMENT 'Número da proposta (ex: PROP-2026-001)',
  `total_value` decimal(10,2) NOT NULL COMMENT 'Valor total',
  `subtotal` decimal(10,2) DEFAULT NULL COMMENT 'Subtotal (antes de impostos)',
  `tax_rate` decimal(5,2) DEFAULT NULL COMMENT 'Taxa de imposto (%)',
  `tax_amount` decimal(10,2) DEFAULT NULL COMMENT 'Valor do imposto',
  `discount_amount` decimal(10,2) DEFAULT 0 COMMENT 'Desconto',
  `discount_percentage` decimal(5,2) DEFAULT 0 COMMENT 'Desconto em %',
  `status` varchar(50) DEFAULT 'draft' COMMENT 'draft, created, sent, viewed, accepted, rejected, expired',
  `valid_until` date DEFAULT NULL COMMENT 'Válido até',
  `sent_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi enviada',
  `viewed_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi visualizada',
  `accepted_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi aceita',
  `rejected_at` timestamp NULL DEFAULT NULL COMMENT 'Quando foi rejeitada',
  `rejection_reason` text DEFAULT NULL COMMENT 'Motivo da rejeição',
  `notes` text DEFAULT NULL COMMENT 'Notas da proposta',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users - quem criou',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_status` (`status`),
  KEY `idx_proposal_number` (`proposal_number`),
  KEY `idx_valid_until` (`valid_until`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_proposals_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_proposals_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 9. ITENS DA PROPOSTA
-- ============================================
CREATE TABLE IF NOT EXISTS `proposal_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `proposal_id` int(11) NOT NULL COMMENT 'FK proposals',
  `product` varchar(255) NOT NULL COMMENT 'Nome do produto/serviço',
  `product_code` varchar(100) DEFAULT NULL COMMENT 'Código do produto',
  `description` text DEFAULT NULL COMMENT 'Descrição detalhada',
  `quantity` decimal(10,2) NOT NULL DEFAULT 1 COMMENT 'Quantidade',
  `unit` varchar(50) DEFAULT 'sqft' COMMENT 'Unidade (sqft, unit, hour, etc.)',
  `unit_price` decimal(10,2) NOT NULL COMMENT 'Preço unitário',
  `labor_cost` decimal(10,2) DEFAULT 0 COMMENT 'Custo de mão de obra',
  `material_cost` decimal(10,2) DEFAULT 0 COMMENT 'Custo de material',
  `margin_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Margem (%)',
  `line_total` decimal(10,2) NOT NULL COMMENT 'Total da linha (quantity * unit_price + labor_cost)',
  `order` int(11) DEFAULT 0 COMMENT 'Ordem de exibição',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proposal_id` (`proposal_id`),
  KEY `idx_order` (`order`),
  CONSTRAINT `fk_proposal_items_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 10. CONTRATOS
-- ============================================
CREATE TABLE IF NOT EXISTS `contracts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `proposal_id` int(11) DEFAULT NULL COMMENT 'FK proposals - proposta que originou o contrato',
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `contract_number` varchar(50) DEFAULT NULL COMMENT 'Número do contrato',
  `signed_at` timestamp NULL DEFAULT NULL COMMENT 'Data de assinatura',
  `signed_by` varchar(255) DEFAULT NULL COMMENT 'Nome de quem assinou',
  `signature_method` varchar(50) DEFAULT NULL COMMENT 'digital, physical, esign',
  `payment_type` varchar(50) DEFAULT NULL COMMENT 'cash, financing, insurance, credit_card',
  `payment_terms` varchar(255) DEFAULT NULL COMMENT 'Condições de pagamento',
  `down_payment` decimal(10,2) DEFAULT NULL COMMENT 'Entrada',
  `down_payment_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Entrada em %',
  `installments_count` int(11) DEFAULT NULL COMMENT 'Número de parcelas',
  `installment_amount` decimal(10,2) DEFAULT NULL COMMENT 'Valor da parcela',
  `total_value` decimal(10,2) NOT NULL COMMENT 'Valor total do contrato',
  `start_date` date DEFAULT NULL COMMENT 'Data de início',
  `end_date` date DEFAULT NULL COMMENT 'Data de término estimada',
  `status` varchar(50) DEFAULT 'draft' COMMENT 'draft, pending_signature, signed, active, completed, cancelled',
  `contract_file_url` varchar(500) DEFAULT NULL COMMENT 'URL do arquivo do contrato',
  `notes` text DEFAULT NULL COMMENT 'Notas do contrato',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users - quem criou',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proposal_id` (`proposal_id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_status` (`status`),
  KEY `idx_contract_number` (`contract_number`),
  KEY `idx_start_date` (`start_date`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_contracts_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `proposals` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_contracts_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_contracts_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 11. PROJETOS (PRODUÇÃO/OBRA)
-- ============================================
CREATE TABLE IF NOT EXISTS `projects` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `contract_id` int(11) DEFAULT NULL COMMENT 'FK contracts',
  `lead_id` int(11) NOT NULL COMMENT 'FK leads',
  `project_number` varchar(50) DEFAULT NULL COMMENT 'Número do projeto',
  `status` varchar(50) DEFAULT 'pending' COMMENT 'pending, scheduled, in_progress, on_hold, completed, cancelled',
  `assigned_team` json DEFAULT NULL COMMENT 'Array de IDs de usuários da equipe',
  `project_manager_id` int(11) DEFAULT NULL COMMENT 'FK users - gerente do projeto',
  `start_date` date DEFAULT NULL COMMENT 'Data de início',
  `end_date` date DEFAULT NULL COMMENT 'Data de término estimada',
  `actual_start_date` date DEFAULT NULL COMMENT 'Data real de início',
  `actual_end_date` date DEFAULT NULL COMMENT 'Data real de término',
  `progress_percentage` int(11) DEFAULT 0 COMMENT 'Progresso (0-100)',
  `address` varchar(500) DEFAULT NULL COMMENT 'Endereço da obra',
  `notes` text DEFAULT NULL COMMENT 'Notas do projeto',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contract_id` (`contract_id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_status` (`status`),
  KEY `idx_project_number` (`project_number`),
  KEY `idx_project_manager` (`project_manager_id`),
  KEY `idx_start_date` (`start_date`),
  CONSTRAINT `fk_projects_contract` FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_projects_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_projects_manager` FOREIGN KEY (`project_manager_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 12. LOGS DE AUDITORIA
-- ============================================
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(50) NOT NULL COMMENT 'leads, proposals, contracts, etc.',
  `entity_id` int(11) NOT NULL COMMENT 'ID da entidade',
  `action` varchar(50) NOT NULL COMMENT 'created, updated, deleted, status_changed',
  `field_name` varchar(100) DEFAULT NULL COMMENT 'Nome do campo alterado',
  `old_value` text DEFAULT NULL COMMENT 'Valor antigo',
  `new_value` text DEFAULT NULL COMMENT 'Valor novo',
  `user_id` int(11) DEFAULT NULL COMMENT 'FK users - quem fez a ação',
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_entity` (`entity_type`, `entity_id`),
  KEY `idx_action` (`action`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DADOS INICIAIS - ESTÁGIOS DO PIPELINE
-- ============================================
INSERT IGNORE INTO `pipeline_stages` (`id`, `name`, `slug`, `description`, `order_num`, `color`, `sla_hours`, `is_closed`) VALUES
(1, 'New Lead', 'new_lead', 'Lead novo — primeiro contacto pendente', 1, '#3498db', 24, 0),
(2, 'Meeting Scheduled', 'meeting_scheduled', 'Reunião ou visita agendada', 2, '#90EE90', 72, 0),
(3, 'Quote Sent', 'quote_sent', 'Orçamento enviado', 3, '#9b59b6', 96, 0),
(4, 'Follow Up', 'follow_up_1', 'Follow-up', 4, '#F1C40F', 72, 0),
(5, 'Stand By', 'stand_by', 'Em espera', 5, '#f39c12', 48, 0),
(6, 'Won', 'won', 'Ganho', 6, '#27ae60', NULL, 1),
(7, 'Lost', 'lost', 'Perdido', 7, '#c0392b', NULL, 1);
