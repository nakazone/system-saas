-- Construction payroll v2: employees, periods, timesheet lines (Senior Floors CRM)
-- Run via: node database/migrate-construction-payroll.js
--
-- Foreign keys are only between payroll tables. We do NOT reference users/projects here:
-- hosts often differ (INT vs INT UNSIGNED, missing projects table, etc.) and that causes
-- ER_CANNOT_ADD_FOREIGN. user_id, project_id, closed_by, created_by are validated in the API.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `construction_payroll_employees` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `role` varchar(128) DEFAULT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `payment_type` enum('daily','hourly','mixed') NOT NULL DEFAULT 'daily',
  `daily_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `hourly_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `overtime_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(64) DEFAULT NULL COMMENT 'check, ach, cash, zelle, etc.',
  `sector` enum('installation','sand_finish') DEFAULT NULL COMMENT 'Installation vs Sand & Finish',
  `user_id` int(11) DEFAULT NULL COMMENT 'optional link to CRM users.id (no FK — type/host variance)',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `allow_work_date_outside_period` tinyint(1) NOT NULL DEFAULT 0 COMMENT '1 = work_date pode estar fora do período; paga neste fechamento',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_payroll_periods` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `frequency` enum('weekly','biweekly','monthly') NOT NULL DEFAULT 'biweekly',
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `status` enum('open','closed') NOT NULL DEFAULT 'open',
  `closed_at` datetime DEFAULT NULL,
  `closed_by` int(11) DEFAULT NULL COMMENT 'users.id when closed (no FK)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dates` (`start_date`,`end_date`),
  KEY `idx_status` (`status`),
  KEY `idx_closed_by` (`closed_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_payroll_timesheets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `project_id` int(11) DEFAULT NULL COMMENT 'projects.id optional (no FK)',
  `project_id_norm` int(11) GENERATED ALWAYS AS (ifnull(`project_id`,0)) STORED,
  `work_date` date NOT NULL,
  `days_worked` decimal(5,2) NOT NULL DEFAULT 0.00 COMMENT '1 or 0.5 for daily; optional for hourly',
  `daily_rate_override` decimal(12,2) DEFAULT NULL COMMENT 'Diária só nesta linha; NULL = usar cadastro',
  `regular_hours` decimal(8,2) NOT NULL DEFAULT 0.00 COMMENT 'for hourly / mixed',
  `overtime_hours` decimal(8,2) NOT NULL DEFAULT 0.00,
  `notes` text DEFAULT NULL,
  `calculated_amount` decimal(14,2) NOT NULL DEFAULT 0.00,
  `created_by` int(11) DEFAULT NULL COMMENT 'users.id (no FK)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cpt_period_emp_date_proj` (`period_id`,`employee_id`,`work_date`,`project_id_norm`),
  KEY `idx_period` (`period_id`),
  KEY `idx_employee` (`employee_id`),
  KEY `idx_project` (`project_id`),
  KEY `idx_work_date` (`work_date`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_cpt_period` FOREIGN KEY (`period_id`) REFERENCES `construction_payroll_periods` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cpt_employee` FOREIGN KEY (`employee_id`) REFERENCES `construction_payroll_employees` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `construction_payroll_period_adjustments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_id` int(11) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `reimbursement` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Reembolso no fechamento do período',
  `discount` decimal(12,2) NOT NULL DEFAULT 0.00 COMMENT 'Desconto no fechamento (subtrai ao total do funcionário)',
  `notes` varchar(500) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_period_employee_adj` (`period_id`,`employee_id`),
  KEY `idx_cppa_employee` (`employee_id`),
  CONSTRAINT `fk_cppa_period` FOREIGN KEY (`period_id`) REFERENCES `construction_payroll_periods` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cppa_employee` FOREIGN KEY (`employee_id`) REFERENCES `construction_payroll_employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
