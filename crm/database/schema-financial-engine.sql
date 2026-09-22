-- ============================================
-- Senior Floors - Financial Management Module
-- Sistema completo de gestão financeira
-- ============================================

-- ============================================
-- 1. PROJECT FINANCIAL (Financeiro por Projeto)
-- ============================================
CREATE TABLE IF NOT EXISTS `project_financials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `project_id` int(11) NOT NULL COMMENT 'FK projects',
  `estimate_id` int(11) DEFAULT NULL COMMENT 'FK estimates (opcional)',
  `estimated_revenue` decimal(10,2) DEFAULT 0.00 COMMENT 'Receita estimada',
  `estimated_material_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo de material estimado',
  `estimated_labor_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo de mão de obra estimado',
  `estimated_overhead` decimal(10,2) DEFAULT 0.00 COMMENT 'Overhead estimado',
  `estimated_profit` decimal(10,2) DEFAULT 0.00 COMMENT 'Lucro estimado',
  `estimated_margin_percentage` decimal(5,2) DEFAULT 0.00 COMMENT 'Margem estimada (%)',
  `actual_revenue` decimal(10,2) DEFAULT 0.00 COMMENT 'Receita real',
  `actual_material_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo de material real',
  `actual_labor_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo de mão de obra real',
  `actual_overhead` decimal(10,2) DEFAULT 0.00 COMMENT 'Overhead real',
  `actual_total_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo total real',
  `actual_profit` decimal(10,2) DEFAULT 0.00 COMMENT 'Lucro real',
  `actual_margin_percentage` decimal(5,2) DEFAULT 0.00 COMMENT 'Margem real (%)',
  `profit_variance` decimal(10,2) DEFAULT 0.00 COMMENT 'Variação de lucro (actual - estimated)',
  `cost_variance` decimal(10,2) DEFAULT 0.00 COMMENT 'Variação de custo',
  `revenue_variance` decimal(10,2) DEFAULT 0.00 COMMENT 'Variação de receita',
  `is_locked` tinyint(1) DEFAULT 0 COMMENT '1=bloqueado (projeto completado)',
  `locked_at` datetime DEFAULT NULL COMMENT 'Data de bloqueio',
  `locked_by` int(11) DEFAULT NULL COMMENT 'FK users - quem bloqueou',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_project_financial` (`project_id`),
  KEY `idx_estimate_id` (`estimate_id`),
  KEY `idx_is_locked` (`is_locked`),
  CONSTRAINT `fk_project_financials_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_project_financials_estimate` FOREIGN KEY (`estimate_id`) REFERENCES `estimates` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_project_financials_locked_by` FOREIGN KEY (`locked_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. EXPENSES (Despesas)
-- ============================================
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` varchar(100) NOT NULL COMMENT 'material | labor | equipment | travel | office | other',
  `project_id` int(11) DEFAULT NULL COMMENT 'FK projects (NULL = overhead geral)',
  `vendor` varchar(255) DEFAULT NULL COMMENT 'Fornecedor/Vendedor',
  `description` text NOT NULL COMMENT 'Descrição da despesa',
  `amount` decimal(10,2) NOT NULL COMMENT 'Valor',
  `tax_amount` decimal(10,2) DEFAULT 0.00 COMMENT 'Valor do imposto',
  `total_amount` decimal(10,2) NOT NULL COMMENT 'Valor total (amount + tax)',
  `payment_method` varchar(50) DEFAULT NULL COMMENT 'cash | check | credit_card | bank_transfer | other',
  `expense_date` date NOT NULL COMMENT 'Data da despesa',
  `status` varchar(50) DEFAULT 'pending' COMMENT 'pending | approved | paid | rejected',
  `receipt_url` varchar(500) DEFAULT NULL COMMENT 'URL do recibo (upload)',
  `receipt_file_path` varchar(500) DEFAULT NULL COMMENT 'Caminho do arquivo do recibo',
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users - quem criou',
  `approved_by` int(11) DEFAULT NULL COMMENT 'FK users - quem aprovou',
  `approved_at` datetime DEFAULT NULL COMMENT 'Data de aprovação',
  `paid_at` datetime DEFAULT NULL COMMENT 'Data de pagamento',
  `rejected_reason` text DEFAULT NULL COMMENT 'Motivo da rejeição',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_category` (`category`),
  KEY `idx_status` (`status`),
  KEY `idx_expense_date` (`expense_date`),
  KEY `idx_created_by` (`created_by`),
  CONSTRAINT `fk_expenses_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_expenses_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_expenses_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. RECEIPTS (Recibos)
-- ============================================
CREATE TABLE IF NOT EXISTS `receipts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `expense_id` int(11) NOT NULL COMMENT 'FK expenses',
  `file_url` varchar(500) NOT NULL COMMENT 'URL do arquivo',
  `file_path` varchar(500) DEFAULT NULL COMMENT 'Caminho do arquivo',
  `file_name` varchar(255) DEFAULT NULL COMMENT 'Nome do arquivo original',
  `file_type` varchar(50) DEFAULT NULL COMMENT 'image/jpeg | image/png | application/pdf',
  `file_size` int(11) DEFAULT NULL COMMENT 'Tamanho em bytes',
  `extracted_amount` decimal(10,2) DEFAULT NULL COMMENT 'Valor extraído (OCR)',
  `extracted_vendor` varchar(255) DEFAULT NULL COMMENT 'Fornecedor extraído (OCR)',
  `extracted_date` date DEFAULT NULL COMMENT 'Data extraída (OCR)',
  `extraction_confidence` decimal(5,2) DEFAULT NULL COMMENT 'Confiança da extração (0-100)',
  `verification_status` varchar(50) DEFAULT 'pending' COMMENT 'pending | verified | rejected',
  `verified_by` int(11) DEFAULT NULL COMMENT 'FK users - quem verificou',
  `verified_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_id` (`expense_id`),
  KEY `idx_verification_status` (`verification_status`),
  CONSTRAINT `fk_receipts_expense` FOREIGN KEY (`expense_id`) REFERENCES `expenses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. PAYROLL ENTRIES (Folha de Pagamento)
-- ============================================
CREATE TABLE IF NOT EXISTS `payroll_entries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `employee_id` int(11) NOT NULL COMMENT 'FK users',
  `project_id` int(11) DEFAULT NULL COMMENT 'FK projects (NULL = overhead)',
  `crew_id` int(11) DEFAULT NULL COMMENT 'FK crews',
  `date` date NOT NULL COMMENT 'Data do trabalho',
  `hours_worked` decimal(5,2) NOT NULL COMMENT 'Horas trabalhadas',
  `hourly_rate` decimal(10,2) NOT NULL COMMENT 'Taxa horária',
  `total_cost` decimal(10,2) NOT NULL COMMENT 'Custo total (hours × rate)',
  `overtime_hours` decimal(5,2) DEFAULT 0.00 COMMENT 'Horas extras',
  `overtime_rate` decimal(10,2) DEFAULT NULL COMMENT 'Taxa de horas extras',
  `overtime_cost` decimal(10,2) DEFAULT 0.00 COMMENT 'Custo de horas extras',
  `approved` tinyint(1) DEFAULT 0 COMMENT '1=aprovado',
  `approved_by` int(11) DEFAULT NULL COMMENT 'FK users - quem aprovou',
  `approved_at` datetime DEFAULT NULL,
  `pay_period_start` date DEFAULT NULL COMMENT 'Início do período de pagamento',
  `pay_period_end` date DEFAULT NULL COMMENT 'Fim do período de pagamento',
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL COMMENT 'FK users',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_employee_id` (`employee_id`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_crew_id` (`crew_id`),
  KEY `idx_date` (`date`),
  KEY `idx_approved` (`approved`),
  KEY `idx_pay_period` (`pay_period_start`, `pay_period_end`),
  CONSTRAINT `fk_payroll_entries_employee` FOREIGN KEY (`employee_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_payroll_entries_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payroll_entries_crew` FOREIGN KEY (`crew_id`) REFERENCES `crews` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payroll_entries_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payroll_entries_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. FINANCIAL TRANSACTIONS (Transações Financeiras)
-- ============================================
CREATE TABLE IF NOT EXISTS `financial_transactions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_type` varchar(50) NOT NULL COMMENT 'income | expense | transfer',
  `project_id` int(11) DEFAULT NULL COMMENT 'FK projects',
  `expense_id` int(11) DEFAULT NULL COMMENT 'FK expenses',
  `payroll_entry_id` int(11) DEFAULT NULL COMMENT 'FK payroll_entries',
  `amount` decimal(10,2) NOT NULL COMMENT 'Valor (positivo para receita, negativo para despesa)',
  `description` text DEFAULT NULL,
  `transaction_date` date NOT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `reference_number` varchar(100) DEFAULT NULL COMMENT 'Número de referência',
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_transaction_type` (`transaction_type`),
  KEY `idx_project_id` (`project_id`),
  KEY `idx_transaction_date` (`transaction_date`),
  CONSTRAINT `fk_financial_transactions_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financial_transactions_expense` FOREIGN KEY (`expense_id`) REFERENCES `expenses` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_financial_transactions_payroll` FOREIGN KEY (`payroll_entry_id`) REFERENCES `payroll_entries` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. COMPANY OVERHEAD POOL (Pool de Overhead Geral)
-- ============================================
CREATE TABLE IF NOT EXISTS `company_overhead_pool` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `period_start` date NOT NULL COMMENT 'Início do período',
  `period_end` date NOT NULL COMMENT 'Fim do período',
  `total_overhead` decimal(10,2) DEFAULT 0.00 COMMENT 'Overhead total do período',
  `allocated_overhead` decimal(10,2) DEFAULT 0.00 COMMENT 'Overhead alocado para projetos',
  `remaining_overhead` decimal(10,2) DEFAULT 0.00 COMMENT 'Overhead restante',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_period` (`period_start`, `period_end`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
