-- ============================================
-- Senior Floors - Smart Scheduling & Crew Allocation Engine
-- Sistema completo de agendamento inteligente
-- ============================================

-- ============================================
-- 1. CREWS (Equipes)
-- ============================================
CREATE TABLE IF NOT EXISTS `crews` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL COMMENT 'Nome da equipe',
  `crew_leader_id` int(11) DEFAULT NULL COMMENT 'FK users - líder da equipe',
  `crew_members` json DEFAULT NULL COMMENT 'Array de IDs de usuários da equipe',
  `specializations` json DEFAULT NULL COMMENT 'Tipos de piso que a equipe trabalha: ["hardwood", "lvp", "tile"]',
  `base_productivity_sqft_per_day` decimal(10,2) DEFAULT 500.00 COMMENT 'Produtividade base em sqft/dia',
  `max_daily_capacity_sqft` decimal(10,2) DEFAULT 800.00 COMMENT 'Capacidade máxima diária',
  `hourly_rate` decimal(10,2) DEFAULT NULL COMMENT 'Taxa horária da equipe',
  `is_active` tinyint(1) DEFAULT 1 COMMENT 'Equipe ativa',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_crew_leader` (`crew_leader_id`),
  KEY `idx_is_active` (`is_active`),
  CONSTRAINT `fk_crews_leader` FOREIGN KEY (`crew_leader_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. PROJECT SCHEDULE (Agendamento de Projetos)
-- ============================================
CREATE TABLE IF NOT EXISTS `project_schedules` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL COMMENT 'FK projects',
  `crew_id` int(11) NOT NULL COMMENT 'FK crews',
  `estimate_id` int(11) DEFAULT NULL COMMENT 'FK estimates (opcional)',
  `start_date` date NOT NULL COMMENT 'Data de início',
  `end_date` date NOT NULL COMMENT 'Data de término',
  `estimated_days` int(11) NOT NULL COMMENT 'Dias estimados',
  `total_sqft` decimal(10,2) NOT NULL COMMENT 'Metragem total do projeto',
  `allocated_sqft` decimal(10,2) DEFAULT 0.00 COMMENT 'Metragem já alocada',
  `status` varchar(50) DEFAULT 'scheduled' COMMENT 'scheduled | in_progress | completed | delayed | cancelled',
  `priority` varchar(20) DEFAULT 'normal' COMMENT 'low | normal | high',
  `locked` tinyint(1) DEFAULT 0 COMMENT '1=bloqueado para ajustes automáticos',
  `projected_profit` decimal(10,2) DEFAULT NULL COMMENT 'Lucro projetado',
  `projected_margin` decimal(5,2) DEFAULT NULL COMMENT 'Margem projetada (%)',
  `delay_risk_level` varchar(20) DEFAULT 'low' COMMENT 'low | medium | high',
  `actual_start_date` date DEFAULT NULL COMMENT 'Data real de início',
  `actual_end_date` date DEFAULT NULL COMMENT 'Data real de término',
  `actual_days` int(11) DEFAULT NULL COMMENT 'Dias reais',
  `notes` text DEFAULT NULL,
  `google_calendar_event_id` varchar(255) DEFAULT NULL COMMENT 'Google Calendar event id',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users - quem criou',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_crew_id` (`crew_id`),
  KEY `idx_start_date` (`start_date`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_status` (`status`),
  KEY `idx_priority` (`priority`),
  CONSTRAINT `fk_project_schedules_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_schedules_crew` FOREIGN KEY (`crew_id`) REFERENCES `crews` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_project_schedules_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. CREW AVAILABILITY (Disponibilidade das Equipes)
-- ============================================
CREATE TABLE IF NOT EXISTS `crew_availability` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `crew_id` int(11) NOT NULL COMMENT 'FK crews',
  `date` date NOT NULL COMMENT 'Data',
  `status` varchar(50) DEFAULT 'available' COMMENT 'available | booked | unavailable | maintenance',
  `daily_capacity_sqft` decimal(10,2) DEFAULT NULL COMMENT 'Capacidade diária (pode variar)',
  `allocated_sqft` decimal(10,2) DEFAULT 0.00 COMMENT 'Metragem já alocada neste dia',
  `is_overbooked` tinyint(1) DEFAULT 0 COMMENT '1=sobrecarregado',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_crew_date` (`crew_id`, `date`),
  KEY `idx_crew_id` (`crew_id`),
  KEY `idx_date` (`date`),
  KEY `idx_status` (`status`),
  KEY `idx_is_overbooked` (`is_overbooked`),
  CONSTRAINT `fk_crew_availability_crew` FOREIGN KEY (`crew_id`) REFERENCES `crews` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. CREW PERFORMANCE STATS (Estatísticas de Performance)
-- ============================================
CREATE TABLE IF NOT EXISTS `crew_performance_stats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `crew_id` int(11) NOT NULL COMMENT 'FK crews',
  `period_start` date NOT NULL COMMENT 'Início do período',
  `period_end` date NOT NULL COMMENT 'Fim do período',
  `avg_productivity_sqft_per_day` decimal(10,2) DEFAULT NULL COMMENT 'Produtividade média',
  `avg_delay_percentage` decimal(5,2) DEFAULT NULL COMMENT 'Percentual médio de atraso',
  `avg_profit_margin` decimal(5,2) DEFAULT NULL COMMENT 'Margem de lucro média',
  `projects_completed` int(11) DEFAULT 0 COMMENT 'Projetos completados',
  `projects_on_time` int(11) DEFAULT 0 COMMENT 'Projetos no prazo',
  `total_revenue` decimal(10,2) DEFAULT 0.00 COMMENT 'Receita total',
  `total_profit` decimal(10,2) DEFAULT 0.00 COMMENT 'Lucro total',
  `total_sqft_completed` decimal(10,2) DEFAULT 0.00 COMMENT 'Metragem total completada',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_crew_period` (`crew_id`, `period_start`, `period_end`),
  KEY `idx_crew_id` (`crew_id`),
  KEY `idx_period` (`period_start`, `period_end`),
  CONSTRAINT `fk_crew_performance_crew` FOREIGN KEY (`crew_id`) REFERENCES `crews` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. SCHEDULE ADJUSTMENTS (Ajustes de Agendamento)
-- ============================================
CREATE TABLE IF NOT EXISTS `schedule_adjustments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_schedule_id` int(11) NOT NULL COMMENT 'FK project_schedules',
  `adjustment_type` varchar(50) NOT NULL COMMENT 'delay | shift | reallocate | cancel',
  `original_start_date` date NOT NULL,
  `original_end_date` date NOT NULL,
  `new_start_date` date DEFAULT NULL,
  `new_end_date` date DEFAULT NULL,
  `reason` text DEFAULT NULL COMMENT 'Motivo do ajuste',
  `auto_applied` tinyint(1) DEFAULT 0 COMMENT '1=aplicado automaticamente',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_schedule_id` (`project_schedule_id`),
  KEY `idx_adjustment_type` (`adjustment_type`),
  CONSTRAINT `fk_schedule_adjustments_schedule` FOREIGN KEY (`project_schedule_id`) REFERENCES `project_schedules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DADOS INICIAIS - Criar equipe padrão
-- ============================================
INSERT IGNORE INTO `crews` (`id`, `name`, `base_productivity_sqft_per_day`, `max_daily_capacity_sqft`, `specializations`) VALUES
(1, 'Crew Alpha', 500.00, 800.00, '["hardwood", "engineered", "lvp"]'),
(2, 'Crew Beta', 450.00, 750.00, '["tile", "laminate"]'),
(3, 'Crew Gamma', 550.00, 850.00, '["hardwood", "engineered"]');
