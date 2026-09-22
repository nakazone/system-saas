-- Senior Floors System - Schema Completo do CRM
-- Execute este SQL no seu banco MySQL (Railway, Hostinger, etc.)
-- Este schema inclui todas as tabelas necessárias para o CRM completo

-- ============================================
-- 1. TABELA DE USUÁRIOS
-- ============================================
-- NOTA: Se você já executou schema.sql antes, execute migrate-users-table.sql primeiro
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL COMMENT 'hash bcrypt',
  `role` varchar(50) DEFAULT 'user' COMMENT 'admin, sales_rep, project_manager, user',
  `is_active` tinyint(1) DEFAULT 1 COMMENT '1=ativo, 0=inativo',
  `phone` varchar(50) DEFAULT NULL,
  `avatar` varchar(500) DEFAULT NULL COMMENT 'URL da foto do perfil',
  `last_login_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. TABELA DE ESTÁGIOS DO PIPELINE (criar antes de leads)
-- ============================================
CREATE TABLE IF NOT EXISTS `pipeline_stages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT 'Nome do estágio (ex: Qualificação, Proposta, Fechamento)',
  `description` text DEFAULT NULL,
  `order` int(11) DEFAULT 0 COMMENT 'Ordem de exibição',
  `color` varchar(20) DEFAULT '#3498db' COMMENT 'Cor do estágio (hex)',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order`),
  KEY `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. TABELA DE LEADS (atualizada e completa)
-- ============================================
CREATE TABLE IF NOT EXISTS `leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `zipcode` varchar(10) NOT NULL,
  `message` text DEFAULT NULL,
  `source` varchar(100) DEFAULT NULL COMMENT 'LP-Hero, LP-Contact, Referral, etc.',
  `form_type` varchar(50) DEFAULT NULL COMMENT 'hero-form, contact-form, etc.',
  `status` varchar(50) DEFAULT 'new' COMMENT 'new, contacted, qualified, converted, lost',
  `priority` varchar(50) DEFAULT 'medium' COMMENT 'low, medium, high',
  `ip_address` varchar(45) DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL COMMENT 'ID do usuário responsável',
  `pipeline_stage_id` int(11) DEFAULT NULL COMMENT 'ID do estágio no pipeline',
  `estimated_value` decimal(10,2) DEFAULT NULL COMMENT 'Valor estimado do projeto',
  `estimated_date` date DEFAULT NULL COMMENT 'Data estimada do projeto',
  `notes` text DEFAULT NULL COMMENT 'Notas gerais sobre o lead',
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
-- 4. TABELA DE NOTAS SOBRE LEADS
-- ============================================
CREATE TABLE IF NOT EXISTS `lead_notes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL COMMENT 'Usuário que criou a nota',
  `note` text NOT NULL,
  `is_private` tinyint(1) DEFAULT 0 COMMENT '1=nota privada, 0=pública',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_created_at` (`created_at`),
  CONSTRAINT `fk_lead_notes_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lead_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. TABELA DE ATIVIDADES/HISTÓRICO
-- ============================================
CREATE TABLE IF NOT EXISTS `lead_activities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL COMMENT 'Usuário que realizou a atividade',
  `activity_type` varchar(50) NOT NULL COMMENT 'call, email, meeting, note, status_change, etc.',
  `title` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `activity_date` timestamp NULL DEFAULT NULL COMMENT 'Data/hora da atividade',
  `duration_minutes` int(11) DEFAULT NULL COMMENT 'Duração em minutos (para calls/meetings)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_activity_type` (`activity_type`),
  KEY `idx_activity_date` (`activity_date`),
  CONSTRAINT `fk_lead_activities_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_lead_activities_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. TABELA DE CONFIGURAÇÕES DO SISTEMA
-- ============================================
CREATE TABLE IF NOT EXISTS `settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `key` varchar(100) NOT NULL COMMENT 'Chave da configuração',
  `value` text DEFAULT NULL COMMENT 'Valor da configuração (JSON ou texto)',
  `type` varchar(50) DEFAULT 'string' COMMENT 'string, number, boolean, json',
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. TABELA DE TAREFAS/TODOS
-- ============================================
CREATE TABLE IF NOT EXISTS `tasks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lead_id` int(11) DEFAULT NULL COMMENT 'Tarefa relacionada a um lead (opcional)',
  `user_id` int(11) DEFAULT NULL COMMENT 'Usuário responsável pela tarefa',
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `due_date` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `priority` varchar(50) DEFAULT 'medium' COMMENT 'low, medium, high',
  `status` varchar(50) DEFAULT 'pending' COMMENT 'pending, in_progress, completed, cancelled',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_lead_id` (`lead_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_due_date` (`due_date`),
  CONSTRAINT `fk_tasks_lead` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DADOS INICIAIS
-- ============================================

-- Inserir estágios padrão do pipeline (antes de inserir leads)
INSERT IGNORE INTO `pipeline_stages` (`id`, `name`, `description`, `order`, `color`) VALUES
(1, 'Novo Lead', 'Lead recém-cadastrado, aguardando primeiro contato', 1, '#3498db'),
(2, 'Qualificação', 'Em processo de qualificação e entendimento das necessidades', 2, '#f39c12'),
(3, 'Proposta', 'Proposta enviada, aguardando resposta do cliente', 3, '#9b59b6'),
(4, 'Negociação', 'Em negociação de termos e valores', 4, '#e67e22'),
(5, 'Fechado', 'Lead convertido em cliente', 5, '#27ae60'),
(6, 'Perdido', 'Lead perdido ou arquivado', 6, '#e74c3c');

-- Inserir usuário admin padrão (senha: admin123 - ALTERE APÓS PRIMEIRO LOGIN!)
-- Hash bcrypt de "admin123": $2a$10$rOzJqZqZqZqZqZqZqZqZqO
-- Vamos usar um hash real - você pode gerar um novo com: node -e "const bcrypt=require('bcryptjs');bcrypt.hash('sua_senha',10).then(h=>console.log(h))"
INSERT IGNORE INTO `users` (`id`, `name`, `email`, `password`, `role`, `is_active`) VALUES
(1, 'Administrador', 'admin@senior-floors.com', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin', 1);
-- Senha padrão: admin123 (ALTERE IMEDIATAMENTE!)

-- Configurações padrão do sistema
INSERT IGNORE INTO `settings` (`key`, `value`, `type`, `description`) VALUES
('company_name', 'Senior Floors', 'string', 'Nome da empresa'),
('company_email', 'contact@senior-floors.com', 'string', 'Email principal da empresa'),
('company_phone', '(303) 555-0123', 'string', 'Telefone principal'),
('round_robin_enabled', 'true', 'boolean', 'Habilitar distribuição automática de leads (round-robin)'),
('default_lead_status', 'new', 'string', 'Status padrão para novos leads'),
('default_lead_priority', 'medium', 'string', 'Prioridade padrão para novos leads');
