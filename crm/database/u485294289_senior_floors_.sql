-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Tempo de geração: 07/02/2026 às 20:49
-- Versão do servidor: 11.8.3-MariaDB-log
-- Versão do PHP: 7.2.34

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Banco de dados: `u485294289_senior_floors_`
--

-- --------------------------------------------------------

--
-- Estrutura para tabela `activities`
--

CREATE TABLE `activities` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `activity_type` enum('email_sent','whatsapp_message','phone_call','meeting_scheduled','site_visit','proposal_sent','note','status_change','assignment','other') DEFAULT 'note',
  `subject` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `activity_date` datetime DEFAULT current_timestamp(),
  `user_id` int(11) DEFAULT NULL COMMENT 'Usuário que executou a ação',
  `owner_id` int(11) DEFAULT NULL COMMENT 'Responsável pela atividade',
  `related_to` varchar(50) DEFAULT NULL COMMENT 'lead, customer, project',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `activities`
--

INSERT INTO `activities` (`id`, `lead_id`, `customer_id`, `project_id`, `activity_type`, `subject`, `description`, `activity_date`, `user_id`, `owner_id`, `related_to`, `created_at`) VALUES
(1, NULL, 1, 1, 'status_change', 'Project Created', 'New project created', '2026-01-28 21:45:43', NULL, NULL, 'project', '2026-01-28 21:45:43');

-- --------------------------------------------------------

--
-- Estrutura para tabela `assignment_history`
--

CREATE TABLE `assignment_history` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `from_user_id` int(11) DEFAULT NULL COMMENT 'De quem foi transferido',
  `to_user_id` int(11) NOT NULL COMMENT 'Para quem foi transferido',
  `reason` text DEFAULT NULL COMMENT 'Motivo da transferência',
  `assigned_by` int(11) DEFAULT NULL COMMENT 'Quem fez a atribuição',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `audit_log`
--

CREATE TABLE `audit_log` (
  `id` int(11) NOT NULL,
  `entity_type` varchar(50) NOT NULL COMMENT 'lead, proposal, contract, project',
  `entity_id` int(11) NOT NULL,
  `action` varchar(50) NOT NULL COMMENT 'status_change, value_change, create, update',
  `field_name` varchar(100) DEFAULT NULL,
  `old_value` text DEFAULT NULL,
  `new_value` text DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `contracts`
--

CREATE TABLE `contracts` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `quote_id` int(11) DEFAULT NULL,
  `closed_amount` decimal(12,2) NOT NULL,
  `payment_method` enum('cash','financing','check','card','other') DEFAULT NULL,
  `installments` int(11) DEFAULT 1,
  `start_date` date DEFAULT NULL COMMENT 'Data início obra',
  `end_date` date DEFAULT NULL COMMENT 'Data prevista término',
  `responsible_id` int(11) DEFAULT NULL COMMENT 'Responsável pela obra',
  `contract_path` varchar(500) DEFAULT NULL,
  `signed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `coupons`
--

CREATE TABLE `coupons` (
  `id` int(11) NOT NULL,
  `code` varchar(50) NOT NULL COMMENT 'Código do cupom',
  `name` varchar(255) DEFAULT NULL COMMENT 'Nome do cupom',
  `discount_type` enum('percentage','fixed') DEFAULT 'percentage',
  `discount_value` decimal(10,2) NOT NULL COMMENT 'Valor do desconto (percentual ou fixo)',
  `max_uses` int(11) DEFAULT NULL COMMENT 'Máximo de usos (NULL = ilimitado)',
  `used_count` int(11) DEFAULT 0 COMMENT 'Quantas vezes foi usado',
  `valid_from` date DEFAULT NULL,
  `valid_until` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `coupons`
--

INSERT INTO `coupons` (`id`, `code`, `name`, `discount_type`, `discount_value`, `max_uses`, `used_count`, `valid_from`, `valid_until`, `is_active`, `created_by`, `created_at`, `updated_at`) VALUES
(1, 'WELCOME10', 'Welcome Discount', 'percentage', 10.00, NULL, 0, NULL, NULL, 1, NULL, '2026-01-28 21:43:35', '2026-01-28 21:43:35'),
(2, 'REFERRAL50', 'Referral Bonus', 'fixed', 50.00, NULL, 0, NULL, NULL, 1, NULL, '2026-01-28 21:43:35', '2026-01-28 21:43:35');

-- --------------------------------------------------------

--
-- Estrutura para tabela `coupon_usage`
--

CREATE TABLE `coupon_usage` (
  `id` int(11) NOT NULL,
  `coupon_id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `discount_amount` decimal(10,2) DEFAULT NULL COMMENT 'Valor do desconto aplicado',
  `used_by` int(11) DEFAULT NULL COMMENT 'Usuário que aplicou',
  `used_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `customers`
--

CREATE TABLE `customers` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL COMMENT 'Lead que originou este cliente',
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(50) DEFAULT NULL,
  `zipcode` varchar(10) DEFAULT NULL,
  `customer_type` enum('residential','commercial','property_manager','investor','builder') DEFAULT 'residential',
  `owner_id` int(11) DEFAULT NULL COMMENT 'Sales rep responsável',
  `status` enum('active','inactive','archived') DEFAULT 'active',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `customers`
--

INSERT INTO `customers` (`id`, `lead_id`, `name`, `email`, `phone`, `address`, `city`, `state`, `zipcode`, `customer_type`, `owner_id`, `status`, `notes`, `created_at`, `updated_at`) VALUES
(1, NULL, 'Teste', 'teste@teste.com', '1111111111', NULL, NULL, NULL, NULL, 'residential', 0, 'active', NULL, '2026-01-28 21:45:24', '2026-01-28 21:45:24');

-- --------------------------------------------------------

--
-- Estrutura para tabela `customer_notes`
--

CREATE TABLE `customer_notes` (
  `id` int(11) NOT NULL,
  `customer_id` int(11) NOT NULL,
  `note` text NOT NULL,
  `created_by` varchar(255) DEFAULT 'admin',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `customer_tags`
--

CREATE TABLE `customer_tags` (
  `id` int(11) NOT NULL,
  `customer_id` int(11) NOT NULL,
  `tag_name` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `delivery_checklists`
--

CREATE TABLE `delivery_checklists` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `item_name` varchar(255) NOT NULL,
  `completed` tinyint(1) DEFAULT 0,
  `completed_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `interactions`
--

CREATE TABLE `interactions` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `type` enum('call','whatsapp','email','visit') NOT NULL,
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `interaction_logs`
--

CREATE TABLE `interaction_logs` (
  `id` int(11) NOT NULL,
  `entity_type` enum('lead','customer','project') NOT NULL,
  `entity_id` int(11) NOT NULL,
  `event_type` varchar(80) NOT NULL COMMENT 'stage_change, email_sent, call, etc.',
  `payload` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`payload`)),
  `user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `leads`
--

CREATE TABLE `leads` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `zipcode` varchar(10) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `property_type` enum('casa','apartamento','comercial') DEFAULT NULL,
  `service_type` varchar(100) DEFAULT NULL COMMENT 'Vinyl, Hardwood, Tile, Carpet, Refinishing, etc.',
  `estimated_area` varchar(50) DEFAULT NULL COMMENT 'Metragem estimada (ex: 50 m²)',
  `main_interest` text DEFAULT NULL,
  `budget_estimated` decimal(12,2) DEFAULT NULL,
  `urgency` enum('imediato','30_dias','60_mais') DEFAULT NULL,
  `is_decision_maker` tinyint(1) DEFAULT NULL COMMENT '1=Sim, 0=Não',
  `payment_type` enum('cash','financing') DEFAULT NULL,
  `has_competition` tinyint(1) DEFAULT NULL COMMENT '1=Sim, 0=Não',
  `lead_score` int(11) DEFAULT 0,
  `disqualification_reason` text DEFAULT NULL COMMENT 'Motivo obrigatório quando lead é desqualificado',
  `last_activity_at` datetime DEFAULT NULL,
  `message` text DEFAULT NULL,
  `source` varchar(50) DEFAULT 'LP' COMMENT 'LP, Website, Ads, etc.',
  `form_type` varchar(50) DEFAULT 'contact-form' COMMENT 'hero-form, contact-form',
  `status` enum('new','contacted','qualified','proposal','closed_won','closed_lost') DEFAULT 'new',
  `owner_id` int(11) DEFAULT NULL,
  `pipeline_stage_id` int(11) DEFAULT NULL,
  `priority` enum('low','medium','high') DEFAULT 'medium',
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `next_follow_up_at` datetime DEFAULT NULL COMMENT 'Data/hora do próximo follow-up'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `leads`
--

INSERT INTO `leads` (`id`, `name`, `email`, `phone`, `zipcode`, `address`, `property_type`, `service_type`, `estimated_area`, `main_interest`, `budget_estimated`, `urgency`, `is_decision_maker`, `payment_type`, `has_competition`, `lead_score`, `disqualification_reason`, `last_activity_at`, `message`, `source`, `form_type`, `status`, `owner_id`, `pipeline_stage_id`, `priority`, `ip_address`, `created_at`, `updated_at`, `next_follow_up_at`) VALUES
(17, 'Douglas Nakazone', 'doug.nakazone@gmail.com', '(983) 215-3767', '80019', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '', 'LP-Hero', 'hero-form', 'new', 1, 1, 'medium', '71.211.141.32', '2026-02-03 05:20:22', '2026-02-03 05:20:22', NULL),
(18, 'Naka', 'naka@gmail.com', '(404) 314-1048', '80019', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '', 'LP-Hero', 'hero-form', 'new', 5, 1, 'medium', '4.53.15.198', '2026-02-07 15:49:23', '2026-02-07 15:49:23', NULL),
(19, 'Douglas N', 'doug@naka.com', '(999) 000-0000', '80019', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '', 'LP-Hero', 'hero-form', 'new', 1, 1, 'medium', '4.53.15.198', '2026-02-07 18:35:55', '2026-02-07 18:35:55', NULL);

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_distribution_rules`
--

CREATE TABLE `lead_distribution_rules` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `type` enum('round_robin','by_region','by_source','manual') DEFAULT 'round_robin',
  `config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Ex: region_mapping, source_mapping' CHECK (json_valid(`config`)),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_distribution_state`
--

CREATE TABLE `lead_distribution_state` (
  `id` int(11) NOT NULL,
  `rule_id` int(11) NOT NULL,
  `last_user_id` int(11) DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_notes`
--

CREATE TABLE `lead_notes` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `note` text NOT NULL,
  `created_by` varchar(100) DEFAULT 'admin',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_qualification`
--

CREATE TABLE `lead_qualification` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `property_type` varchar(50) DEFAULT NULL,
  `service_type` varchar(100) DEFAULT NULL,
  `estimated_area` decimal(10,2) DEFAULT NULL,
  `estimated_budget` decimal(12,2) DEFAULT NULL,
  `urgency` varchar(30) DEFAULT NULL,
  `decision_maker` tinyint(1) DEFAULT NULL COMMENT '1=Sim, 0=Não',
  `payment_type` varchar(30) DEFAULT NULL,
  `score` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_status_change_log`
--

CREATE TABLE `lead_status_change_log` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `from_stage_id` int(11) DEFAULT NULL,
  `to_stage_id` int(11) NOT NULL,
  `changed_by` int(11) DEFAULT NULL COMMENT 'user_id',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `lead_status_change_log`
--

INSERT INTO `lead_status_change_log` (`id`, `lead_id`, `from_stage_id`, `to_stage_id`, `changed_by`, `notes`, `created_at`) VALUES
(1, 5, 4, 1, NULL, '', '2026-01-30 15:02:15'),
(2, 9, 1, 2, NULL, '', '2026-01-30 19:20:42'),
(3, 9, 2, 3, NULL, '', '2026-01-30 19:20:48');

-- --------------------------------------------------------

--
-- Estrutura para tabela `lead_tags`
--

CREATE TABLE `lead_tags` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `tag` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `measurements`
--

CREATE TABLE `measurements` (
  `id` int(11) NOT NULL,
  `visit_id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `area_sqft` decimal(10,2) DEFAULT NULL COMMENT 'Metragem em pés quadrados',
  `rooms` varchar(255) DEFAULT NULL COMMENT 'Cômodos/áreas',
  `technical_notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `permissions`
--

CREATE TABLE `permissions` (
  `id` int(11) NOT NULL,
  `permission_key` varchar(100) NOT NULL COMMENT 'Chave única da permissão (ex: leads.view)',
  `permission_name` varchar(255) NOT NULL COMMENT 'Nome legível da permissão',
  `permission_group` varchar(50) DEFAULT NULL COMMENT 'Grupo da permissão (leads, customers, projects, etc.)',
  `description` text DEFAULT NULL COMMENT 'Descrição da permissão',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `permissions`
--

INSERT INTO `permissions` (`id`, `permission_key`, `permission_name`, `permission_group`, `description`, `created_at`) VALUES
(1, 'dashboard.view', 'View Dashboard', 'dashboard', 'Visualizar o dashboard principal', '2026-01-28 22:25:40'),
(2, 'leads.view', 'View Leads', 'leads', 'Visualizar lista de leads', '2026-01-28 22:25:40'),
(3, 'leads.create', 'Create Leads', 'leads', 'Criar novos leads', '2026-01-28 22:25:40'),
(4, 'leads.edit', 'Edit Leads', 'leads', 'Editar leads existentes', '2026-01-28 22:25:40'),
(5, 'leads.delete', 'Delete Leads', 'leads', 'Excluir leads', '2026-01-28 22:25:40'),
(6, 'leads.assign', 'Assign Leads', 'leads', 'Atribuir leads a outros usuários', '2026-01-28 22:25:40'),
(7, 'customers.view', 'View Customers', 'customers', 'Visualizar lista de customers', '2026-01-28 22:25:40'),
(8, 'customers.create', 'Create Customers', 'customers', 'Criar novos customers', '2026-01-28 22:25:40'),
(9, 'customers.edit', 'Edit Customers', 'customers', 'Editar customers existentes', '2026-01-28 22:25:40'),
(10, 'customers.delete', 'Delete Customers', 'customers', 'Excluir customers', '2026-01-28 22:25:40'),
(11, 'projects.view', 'View Projects', 'projects', 'Visualizar lista de projects', '2026-01-28 22:25:40'),
(12, 'projects.create', 'Create Projects', 'projects', 'Criar novos projects', '2026-01-28 22:25:40'),
(13, 'projects.edit', 'Edit Projects', 'projects', 'Editar projects existentes', '2026-01-28 22:25:40'),
(14, 'projects.delete', 'Delete Projects', 'projects', 'Excluir projects', '2026-01-28 22:25:40'),
(15, 'projects.update_status', 'Update Project Status', 'projects', 'Atualizar status de projects', '2026-01-28 22:25:40'),
(16, 'coupons.view', 'View Coupons', 'coupons', 'Visualizar lista de coupons', '2026-01-28 22:25:40'),
(17, 'coupons.create', 'Create Coupons', 'coupons', 'Criar novos coupons', '2026-01-28 22:25:40'),
(18, 'coupons.edit', 'Edit Coupons', 'coupons', 'Editar coupons existentes', '2026-01-28 22:25:40'),
(19, 'coupons.delete', 'Delete Coupons', 'coupons', 'Excluir coupons', '2026-01-28 22:25:40'),
(20, 'users.view', 'View Users', 'users', 'Visualizar lista de usuários', '2026-01-28 22:25:40'),
(21, 'users.create', 'Create Users', 'users', 'Criar novos usuários', '2026-01-28 22:25:40'),
(22, 'users.edit', 'Edit Users', 'users', 'Editar usuários existentes', '2026-01-28 22:25:40'),
(23, 'users.delete', 'Delete Users', 'users', 'Excluir usuários', '2026-01-28 22:25:40'),
(24, 'users.manage_permissions', 'Manage User Permissions', 'users', 'Gerenciar permissões de usuários', '2026-01-28 22:25:40'),
(25, 'settings.view', 'View Settings', 'settings', 'Visualizar configurações', '2026-01-28 22:25:40'),
(26, 'settings.edit', 'Edit Settings', 'settings', 'Editar configurações', '2026-01-28 22:25:40'),
(27, 'activities.view', 'View Activities', 'activities', 'Visualizar atividades', '2026-01-28 22:25:40'),
(28, 'activities.create', 'Create Activities', 'activities', 'Criar atividades', '2026-01-28 22:25:40'),
(29, 'reports.view', 'View Reports', 'reports', 'Visualizar relatórios', '2026-01-28 22:25:40'),
(30, 'reports.export', 'Export Reports', 'reports', 'Exportar relatórios', '2026-01-28 22:25:40'),
(31, 'visits.view', 'View Visits', 'visits', 'Visualizar visitas e medições', '2026-01-29 15:58:14'),
(32, 'visits.create', 'Create Visits', 'visits', 'Agendar visitas', '2026-01-29 15:58:14'),
(33, 'visits.edit', 'Edit Visits', 'visits', 'Editar visitas e registrar medições', '2026-01-29 15:58:14'),
(34, 'quotes.view', 'View Quotes', 'quotes', 'Visualizar orçamentos', '2026-01-29 15:58:14'),
(35, 'quotes.create', 'Create Quotes', 'quotes', 'Criar orçamentos', '2026-01-29 15:58:14'),
(36, 'quotes.edit', 'Edit Quotes', 'quotes', 'Editar e alterar status de orçamentos', '2026-01-29 15:58:14'),
(37, 'pipeline.view', 'View Pipeline', 'pipeline', 'Visualizar pipeline Kanban', '2026-01-29 15:58:14'),
(38, 'pipeline.edit', 'Move Pipeline', 'pipeline', 'Mover leads entre estágios', '2026-01-29 15:58:14'),
(39, 'contracts.view', 'View Contracts', 'contracts', 'Visualizar contratos', '2026-01-29 15:58:14'),
(40, 'contracts.create', 'Create Contracts', 'contracts', 'Fechar venda e criar contrato', '2026-01-29 15:58:14');

-- --------------------------------------------------------

--
-- Estrutura para tabela `pipeline_stages`
--

CREATE TABLE `pipeline_stages` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `slug` varchar(50) NOT NULL,
  `order_num` int(11) DEFAULT 0,
  `sla_hours` int(11) DEFAULT NULL COMMENT 'SLA em horas para sair deste estágio',
  `required_actions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Ações obrigatórias' CHECK (json_valid(`required_actions`)),
  `required_fields` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Campos obrigatórios' CHECK (json_valid(`required_fields`)),
  `is_closed` tinyint(1) DEFAULT 0 COMMENT '1=estágio final (ganhou/perdeu)',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `pipeline_stages`
--

INSERT INTO `pipeline_stages` (`id`, `name`, `slug`, `order_num`, `sla_hours`, `required_actions`, `required_fields`, `is_closed`, `created_at`) VALUES
(1, 'Lead Recebido', 'lead_received', 1, 24, NULL, NULL, 0, '2026-01-29 15:58:25'),
(2, 'Contato Realizado', 'contact_made', 2, 48, NULL, NULL, 0, '2026-01-29 15:58:25'),
(3, 'Qualificado', 'qualified', 3, 72, NULL, NULL, 0, '2026-01-29 15:58:25'),
(4, 'Visita Agendada', 'visit_scheduled', 4, 168, NULL, NULL, 0, '2026-01-29 15:58:25'),
(5, 'Medição Realizada', 'measurement_done', 5, 72, NULL, NULL, 0, '2026-01-29 15:58:25'),
(6, 'Orçamento enviado', 'quote_sent', 6, 168, NULL, NULL, 0, '2026-01-29 15:58:25'),
(7, 'Em Negociação', 'negotiation', 8, 336, NULL, NULL, 0, '2026-01-29 15:58:25'),
(8, 'Fechado - Ganhou', 'closed_won', 9, NULL, NULL, NULL, 1, '2026-01-29 15:58:25'),
(9, 'Fechado - Perdido', 'closed_lost', 10, NULL, NULL, NULL, 1, '2026-01-29 15:58:25'),
(10, 'Pós-venda', 'post_sale', 10, NULL, NULL, NULL, 0, '2026-01-29 15:58:25'),
(31, 'Proposta Criada', 'proposal_created', 6, 72, NULL, NULL, 0, '2026-01-30 00:22:23'),
(32, 'Proposta Enviada', 'proposal_sent', 7, 168, NULL, NULL, 0, '2026-01-30 00:22:23'),
(33, 'Produção / Obra', 'production', 11, NULL, NULL, NULL, 0, '2026-01-30 00:22:23');

-- --------------------------------------------------------

--
-- Estrutura para tabela `projects`
--

CREATE TABLE `projects` (
  `id` int(11) NOT NULL,
  `customer_id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL COMMENT 'Lead que originou este projeto',
  `name` varchar(255) NOT NULL COMMENT 'Nome do projeto',
  `project_type` enum('installation','refinishing','repair','maintenance') DEFAULT 'installation',
  `status` enum('quoted','scheduled','in_progress','completed','cancelled','on_hold') DEFAULT 'quoted',
  `post_service_status` enum('installation_scheduled','installation_completed','follow_up_sent','review_requested','warranty_active') DEFAULT NULL COMMENT 'Status de pós-atendimento',
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(50) DEFAULT NULL,
  `zipcode` varchar(10) DEFAULT NULL,
  `estimated_start_date` date DEFAULT NULL,
  `estimated_end_date` date DEFAULT NULL,
  `actual_start_date` date DEFAULT NULL,
  `actual_end_date` date DEFAULT NULL,
  `estimated_cost` decimal(10,2) DEFAULT NULL,
  `actual_cost` decimal(10,2) DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL COMMENT 'Sales rep/Project manager responsável',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `projects`
--

INSERT INTO `projects` (`id`, `customer_id`, `lead_id`, `name`, `project_type`, `status`, `post_service_status`, `address`, `city`, `state`, `zipcode`, `estimated_start_date`, `estimated_end_date`, `actual_start_date`, `actual_end_date`, `estimated_cost`, `actual_cost`, `owner_id`, `notes`, `created_at`, `updated_at`) VALUES
(1, 1, NULL, 'Teste', 'installation', 'quoted', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, NULL, 0, NULL, '2026-01-28 21:45:43', '2026-01-28 21:45:43');

-- --------------------------------------------------------

--
-- Estrutura para tabela `project_documents`
--

CREATE TABLE `project_documents` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `doc_type` varchar(50) DEFAULT NULL COMMENT 'contrato, foto_entrega, etc.',
  `uploaded_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `project_issues`
--

CREATE TABLE `project_issues` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `description` text NOT NULL,
  `status` enum('open','in_progress','resolved') DEFAULT 'open',
  `reported_by` int(11) DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `project_notes`
--

CREATE TABLE `project_notes` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `note` text NOT NULL,
  `created_by` varchar(255) DEFAULT 'admin',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `project_tags`
--

CREATE TABLE `project_tags` (
  `id` int(11) NOT NULL,
  `project_id` int(11) NOT NULL,
  `tag_name` varchar(50) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `quotes`
--

CREATE TABLE `quotes` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `version` int(11) DEFAULT 1,
  `total_amount` decimal(12,2) NOT NULL,
  `labor_amount` decimal(12,2) DEFAULT 0.00,
  `materials_amount` decimal(12,2) DEFAULT 0.00,
  `margin_percent` decimal(5,2) DEFAULT NULL,
  `status` enum('draft','sent','viewed','approved','rejected','accepted','declined','expired') DEFAULT 'draft',
  `sent_at` datetime DEFAULT NULL,
  `viewed_at` datetime DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `pdf_path` varchar(500) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `quote_number` varchar(50) DEFAULT NULL COMMENT 'Sequential display number e.g. Q-2024-0001',
  `issue_date` date DEFAULT NULL,
  `expiration_date` date DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT NULL,
  `discount_type` enum('percentage','fixed') DEFAULT 'percentage',
  `discount_value` decimal(12,2) DEFAULT 0.00,
  `tax_total` decimal(12,2) DEFAULT 0.00,
  `notes` text DEFAULT NULL COMMENT 'Public notes on quote',
  `internal_notes` text DEFAULT NULL COMMENT 'Admin only',
  `currency` varchar(3) DEFAULT 'USD',
  `public_token` varchar(64) DEFAULT NULL COMMENT 'Secure token for public view link',
  `declined_at` datetime DEFAULT NULL,
  `decline_reason` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `quotes`
--

INSERT INTO `quotes` (`id`, `lead_id`, `customer_id`, `project_id`, `version`, `total_amount`, `labor_amount`, `materials_amount`, `margin_percent`, `status`, `sent_at`, `viewed_at`, `approved_at`, `pdf_path`, `created_by`, `created_at`, `updated_at`, `quote_number`, `issue_date`, `expiration_date`, `subtotal`, `discount_type`, `discount_value`, `tax_total`, `notes`, `internal_notes`, `currency`, `public_token`, `declined_at`, `decline_reason`) VALUES
(1, 2, NULL, NULL, 1, 110.40, 14.40, 96.00, 15.00, 'draft', NULL, NULL, NULL, NULL, NULL, '2026-02-07 18:42:24', '2026-02-07 18:42:24', NULL, NULL, NULL, NULL, 'percentage', 0.00, 0.00, NULL, NULL, 'USD', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Estrutura para tabela `quote_items`
--

CREATE TABLE `quote_items` (
  `id` int(11) NOT NULL,
  `quote_id` int(11) NOT NULL,
  `floor_type` varchar(100) NOT NULL COMMENT 'Vinyl, Hardwood, Tile, etc.',
  `area_sqft` decimal(10,2) NOT NULL,
  `unit_price` decimal(10,2) NOT NULL,
  `total_price` decimal(12,2) NOT NULL,
  `notes` text DEFAULT NULL,
  `type` enum('material','labor','service') DEFAULT 'material',
  `name` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `quantity` decimal(12,2) DEFAULT 1.00
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `quote_items`
--

INSERT INTO `quote_items` (`id`, `quote_id`, `floor_type`, `area_sqft`, `unit_price`, `total_price`, `notes`, `type`, `name`, `description`, `quantity`) VALUES
(1, 1, 'vinyl', 32.00, 3.00, 96.00, NULL, 'material', NULL, NULL, 1.00);

-- --------------------------------------------------------

--
-- Estrutura para tabela `scheduled_followups`
--

CREATE TABLE `scheduled_followups` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) NOT NULL,
  `scheduled_at` datetime NOT NULL,
  `channel` enum('email','whatsapp','phone') DEFAULT 'whatsapp',
  `message_template` text DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `tasks`
--

CREATE TABLE `tasks` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `due_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `assigned_to` int(11) DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `tasks`
--

INSERT INTO `tasks` (`id`, `lead_id`, `customer_id`, `project_id`, `title`, `description`, `due_at`, `completed_at`, `assigned_to`, `created_by`, `created_at`, `updated_at`) VALUES
(1, 2, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-30 22:13:30', NULL, NULL, NULL, '2026-01-29 22:13:30', '2026-01-29 22:13:30'),
(2, 3, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-30 22:18:24', NULL, 1, NULL, '2026-01-29 22:18:24', '2026-01-29 22:18:24'),
(3, 4, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-30 22:32:15', NULL, 1, NULL, '2026-01-29 22:32:15', '2026-01-29 22:32:15'),
(4, 5, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-30 22:36:42', NULL, 1, NULL, '2026-01-29 22:36:42', '2026-01-29 22:36:42'),
(5, 6, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-30 22:55:02', NULL, 1, NULL, '2026-01-29 22:55:02', '2026-01-29 22:55:02'),
(6, 7, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-31 16:21:37', NULL, 1, NULL, '2026-01-30 16:21:37', '2026-01-30 16:21:37'),
(7, 8, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-31 16:57:22', NULL, 5, NULL, '2026-01-30 16:57:22', '2026-01-30 16:57:22'),
(8, 9, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-31 17:04:29', NULL, 1, NULL, '2026-01-30 17:04:29', '2026-01-30 17:04:29'),
(9, 10, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-01-31 23:15:11', NULL, 5, NULL, '2026-01-30 23:15:11', '2026-01-30 23:15:11'),
(10, 11, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 18:59:44', NULL, 1, NULL, '2026-01-31 18:59:44', '2026-01-31 18:59:44'),
(11, 12, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 19:17:54', NULL, 5, NULL, '2026-01-31 19:17:54', '2026-01-31 19:17:54'),
(12, 13, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 19:20:10', NULL, 1, NULL, '2026-01-31 19:20:10', '2026-01-31 19:20:10'),
(13, 14, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 19:24:44', NULL, 5, NULL, '2026-01-31 19:24:44', '2026-01-31 19:24:44'),
(14, 15, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 19:39:46', NULL, 1, NULL, '2026-01-31 19:39:46', '2026-01-31 19:39:46'),
(15, 16, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-01 19:42:09', NULL, 5, NULL, '2026-01-31 19:42:09', '2026-01-31 19:42:09'),
(16, 17, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-04 05:20:22', NULL, 1, NULL, '2026-02-03 05:20:22', '2026-02-03 05:20:22'),
(17, 18, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-08 15:49:23', NULL, 5, NULL, '2026-02-07 15:49:23', '2026-02-07 15:49:23'),
(18, 19, NULL, NULL, 'Contatar lead', 'Primeiro contato com o lead (entrada automática)', '2026-02-08 18:35:55', NULL, 1, NULL, '2026-02-07 18:35:55', '2026-02-07 18:35:55');

-- --------------------------------------------------------

--
-- Estrutura para tabela `users`
--

CREATE TABLE `users` (
  `id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `role` enum('admin','sales_rep','project_manager','support') DEFAULT 'sales_rep',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `password_hash` varchar(255) DEFAULT NULL COMMENT 'Hash da senha (bcrypt)',
  `email_verified` tinyint(1) DEFAULT 0,
  `last_login` timestamp NULL DEFAULT NULL,
  `login_attempts` int(11) DEFAULT 0,
  `locked_until` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `users`
--

INSERT INTO `users` (`id`, `name`, `email`, `phone`, `role`, `is_active`, `created_at`, `updated_at`, `password_hash`, `email_verified`, `last_login`, `login_attempts`, `locked_until`) VALUES
(1, 'Admin', 'admin@senior-floors.com', NULL, 'admin', 1, '2026-01-28 21:43:35', '2026-01-28 21:43:35', NULL, 0, NULL, 0, NULL),
(5, 'Douglas Nakazone', 'leads@senior-floors.com', NULL, 'project_manager', 1, '2026-01-30 00:08:28', '2026-01-30 00:08:28', '$2y$10$iV0AbPl3gvmb6L/aN//wbeBhwXGb946kd5J2D0WjYg3U/sDLeCWfu', 0, NULL, 0, NULL),
(6, 'Victor Castro', 'contact@senior-floors.com', NULL, 'support', 1, '2026-01-30 00:14:13', '2026-01-30 00:14:13', '$2y$10$7/LGTp.WH2NmjUceLWdM2u6VXqrFwy4kEo8r.aS6kcMOZEmYa7qyC', 0, NULL, 0, NULL);

-- --------------------------------------------------------

--
-- Estrutura para tabela `user_permissions`
--

CREATE TABLE `user_permissions` (
  `id` int(11) NOT NULL,
  `user_id` int(11) NOT NULL,
  `permission_id` int(11) NOT NULL,
  `granted` tinyint(1) DEFAULT 1 COMMENT '1 = permitido, 0 = negado',
  `granted_by` int(11) DEFAULT NULL COMMENT 'Usuário que concedeu a permissão',
  `granted_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Despejando dados para a tabela `user_permissions`
--

INSERT INTO `user_permissions` (`id`, `user_id`, `permission_id`, `granted`, `granted_by`, `granted_at`) VALUES
(1, 1, 27, 1, NULL, '2026-01-28 22:25:40'),
(2, 1, 28, 1, NULL, '2026-01-28 22:25:40'),
(3, 1, 16, 1, NULL, '2026-01-28 22:25:40'),
(4, 1, 17, 1, NULL, '2026-01-28 22:25:40'),
(5, 1, 18, 1, NULL, '2026-01-28 22:25:40'),
(6, 1, 19, 1, NULL, '2026-01-28 22:25:40'),
(7, 1, 7, 1, NULL, '2026-01-28 22:25:40'),
(8, 1, 8, 1, NULL, '2026-01-28 22:25:40'),
(9, 1, 9, 1, NULL, '2026-01-28 22:25:40'),
(10, 1, 10, 1, NULL, '2026-01-28 22:25:40'),
(11, 1, 1, 1, NULL, '2026-01-28 22:25:40'),
(12, 1, 2, 1, NULL, '2026-01-28 22:25:40'),
(13, 1, 3, 1, NULL, '2026-01-28 22:25:40'),
(14, 1, 4, 1, NULL, '2026-01-28 22:25:40'),
(15, 1, 5, 1, NULL, '2026-01-28 22:25:40'),
(16, 1, 6, 1, NULL, '2026-01-28 22:25:40'),
(17, 1, 11, 1, NULL, '2026-01-28 22:25:40'),
(18, 1, 12, 1, NULL, '2026-01-28 22:25:40'),
(19, 1, 13, 1, NULL, '2026-01-28 22:25:40'),
(20, 1, 14, 1, NULL, '2026-01-28 22:25:40'),
(21, 1, 15, 1, NULL, '2026-01-28 22:25:40'),
(22, 1, 29, 1, NULL, '2026-01-28 22:25:40'),
(23, 1, 30, 1, NULL, '2026-01-28 22:25:40'),
(24, 1, 25, 1, NULL, '2026-01-28 22:25:40'),
(25, 1, 26, 1, NULL, '2026-01-28 22:25:40'),
(26, 1, 20, 1, NULL, '2026-01-28 22:25:40'),
(27, 1, 21, 1, NULL, '2026-01-28 22:25:40'),
(28, 1, 22, 1, NULL, '2026-01-28 22:25:40'),
(29, 1, 23, 1, NULL, '2026-01-28 22:25:40'),
(30, 1, 24, 1, NULL, '2026-01-28 22:25:40'),
(32, 1, 40, 1, NULL, '2026-01-29 15:58:14'),
(33, 1, 39, 1, NULL, '2026-01-29 15:58:14'),
(34, 1, 38, 1, NULL, '2026-01-29 15:58:14'),
(35, 1, 37, 1, NULL, '2026-01-29 15:58:14'),
(36, 1, 35, 1, NULL, '2026-01-29 15:58:14'),
(37, 1, 36, 1, NULL, '2026-01-29 15:58:14'),
(38, 1, 34, 1, NULL, '2026-01-29 15:58:14'),
(39, 1, 32, 1, NULL, '2026-01-29 15:58:14'),
(40, 1, 33, 1, NULL, '2026-01-29 15:58:14'),
(41, 1, 31, 1, NULL, '2026-01-29 15:58:14');

-- --------------------------------------------------------

--
-- Estrutura para tabela `visits`
--

CREATE TABLE `visits` (
  `id` int(11) NOT NULL,
  `lead_id` int(11) DEFAULT NULL,
  `customer_id` int(11) DEFAULT NULL,
  `project_id` int(11) DEFAULT NULL,
  `scheduled_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,
  `seller_id` int(11) DEFAULT NULL COMMENT 'Vendedor',
  `technician_id` int(11) DEFAULT NULL COMMENT 'Técnico / Medidor',
  `address` text DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('scheduled','completed','cancelled','no_show') DEFAULT 'scheduled',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `visit_attachments`
--

CREATE TABLE `visit_attachments` (
  `id` int(11) NOT NULL,
  `visit_id` int(11) NOT NULL,
  `file_path` varchar(500) NOT NULL,
  `file_type` enum('photo','video','document') DEFAULT 'photo',
  `created_at` timestamp NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Estrutura para tabela `workflows`
--

CREATE TABLE `workflows` (
  `id` int(11) NOT NULL,
  `name` varchar(150) NOT NULL,
  `trigger_type` enum('stage_change','inactivity','new_lead','schedule') NOT NULL,
  `trigger_config` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`trigger_config`)),
  `actions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'Lista de ações: email, whatsapp, task, stage_change' CHECK (json_valid(`actions`)),
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Índices para tabelas despejadas
--

--
-- Índices de tabela `activities`
--
ALTER TABLE `activities`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_activity_type` (`activity_type`),
  ADD KEY `idx_activity_date` (`activity_date`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_owner_id` (`owner_id`),
  ADD KEY `idx_activity_lead_date` (`lead_id`,`activity_date`),
  ADD KEY `idx_activity_customer_date` (`customer_id`,`activity_date`);

--
-- Índices de tabela `assignment_history`
--
ALTER TABLE `assignment_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_to_user_id` (`to_user_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_entity` (`entity_type`,`entity_id`),
  ADD KEY `idx_action` (`action`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `contracts`
--
ALTER TABLE `contracts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_quote_id` (`quote_id`);

--
-- Índices de tabela `coupons`
--
ALTER TABLE `coupons`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`),
  ADD UNIQUE KEY `unique_code` (`code`),
  ADD KEY `idx_is_active` (`is_active`),
  ADD KEY `idx_valid_until` (`valid_until`);

--
-- Índices de tabela `coupon_usage`
--
ALTER TABLE `coupon_usage`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_coupon_id` (`coupon_id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_used_at` (`used_at`);

--
-- Índices de tabela `customers`
--
ALTER TABLE `customers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_owner_id` (`owner_id`),
  ADD KEY `idx_customer_type` (`customer_type`),
  ADD KEY `idx_status` (`status`);

--
-- Índices de tabela `customer_notes`
--
ALTER TABLE `customer_notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `customer_tags`
--
ALTER TABLE `customer_tags`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_customer_tag` (`customer_id`,`tag_name`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_tag_name` (`tag_name`);

--
-- Índices de tabela `delivery_checklists`
--
ALTER TABLE `delivery_checklists`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_project_id` (`project_id`);

--
-- Índices de tabela `interactions`
--
ALTER TABLE `interactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_type` (`type`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `interaction_logs`
--
ALTER TABLE `interaction_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_entity` (`entity_type`,`entity_id`),
  ADD KEY `idx_event_type` (`event_type`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `leads`
--
ALTER TABLE `leads`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_source` (`source`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_email` (`email`),
  ADD KEY `idx_pipeline_stage_id` (`pipeline_stage_id`),
  ADD KEY `idx_owner_id` (`owner_id`),
  ADD KEY `idx_next_follow_up_at` (`next_follow_up_at`);

--
-- Índices de tabela `lead_distribution_rules`
--
ALTER TABLE `lead_distribution_rules`
  ADD PRIMARY KEY (`id`);

--
-- Índices de tabela `lead_distribution_state`
--
ALTER TABLE `lead_distribution_state`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `rule_id` (`rule_id`);

--
-- Índices de tabela `lead_notes`
--
ALTER TABLE `lead_notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`);

--
-- Índices de tabela `lead_qualification`
--
ALTER TABLE `lead_qualification`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `lead_id` (`lead_id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_score` (`score`);

--
-- Índices de tabela `lead_status_change_log`
--
ALTER TABLE `lead_status_change_log`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_to_stage` (`to_stage_id`);

--
-- Índices de tabela `lead_tags`
--
ALTER TABLE `lead_tags`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_tag` (`tag`);

--
-- Índices de tabela `measurements`
--
ALTER TABLE `measurements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_visit_id` (`visit_id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_project_id` (`project_id`);

--
-- Índices de tabela `permissions`
--
ALTER TABLE `permissions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `permission_key` (`permission_key`),
  ADD UNIQUE KEY `unique_permission_key` (`permission_key`),
  ADD KEY `idx_permission_group` (`permission_group`);

--
-- Índices de tabela `pipeline_stages`
--
ALTER TABLE `pipeline_stages`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `slug` (`slug`),
  ADD KEY `idx_order` (`order_num`);

--
-- Índices de tabela `projects`
--
ALTER TABLE `projects`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_project_type` (`project_type`),
  ADD KEY `idx_owner_id` (`owner_id`),
  ADD KEY `idx_estimated_start_date` (`estimated_start_date`),
  ADD KEY `idx_post_service_status` (`post_service_status`),
  ADD KEY `idx_project_status_dates` (`status`,`estimated_start_date`);

--
-- Índices de tabela `project_documents`
--
ALTER TABLE `project_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_project_id` (`project_id`);

--
-- Índices de tabela `project_issues`
--
ALTER TABLE `project_issues`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_project_id` (`project_id`);

--
-- Índices de tabela `project_notes`
--
ALTER TABLE `project_notes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_created_at` (`created_at`);

--
-- Índices de tabela `project_tags`
--
ALTER TABLE `project_tags`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_project_tag` (`project_id`,`tag_name`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_tag_name` (`tag_name`);

--
-- Índices de tabela `quotes`
--
ALTER TABLE `quotes`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `quote_number` (`quote_number`),
  ADD UNIQUE KEY `public_token` (`public_token`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_status` (`status`);

--
-- Índices de tabela `quote_items`
--
ALTER TABLE `quote_items`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_quote_id` (`quote_id`);

--
-- Índices de tabela `scheduled_followups`
--
ALTER TABLE `scheduled_followups`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_scheduled_at` (`scheduled_at`);

--
-- Índices de tabela `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_assigned_to` (`assigned_to`),
  ADD KEY `idx_due_at` (`due_at`);

--
-- Índices de tabela `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD UNIQUE KEY `unique_email` (`email`),
  ADD KEY `idx_role` (`role`),
  ADD KEY `idx_is_active` (`is_active`);

--
-- Índices de tabela `user_permissions`
--
ALTER TABLE `user_permissions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_user_permission` (`user_id`,`permission_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_permission_id` (`permission_id`);

--
-- Índices de tabela `visits`
--
ALTER TABLE `visits`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_lead_id` (`lead_id`),
  ADD KEY `idx_customer_id` (`customer_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_scheduled_at` (`scheduled_at`),
  ADD KEY `idx_seller_id` (`seller_id`),
  ADD KEY `idx_technician_id` (`technician_id`);

--
-- Índices de tabela `visit_attachments`
--
ALTER TABLE `visit_attachments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_visit_id` (`visit_id`);

--
-- Índices de tabela `workflows`
--
ALTER TABLE `workflows`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT para tabelas despejadas
--

--
-- AUTO_INCREMENT de tabela `activities`
--
ALTER TABLE `activities`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT de tabela `assignment_history`
--
ALTER TABLE `assignment_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `contracts`
--
ALTER TABLE `contracts`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `coupons`
--
ALTER TABLE `coupons`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT de tabela `coupon_usage`
--
ALTER TABLE `coupon_usage`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `customers`
--
ALTER TABLE `customers`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de tabela `customer_notes`
--
ALTER TABLE `customer_notes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `customer_tags`
--
ALTER TABLE `customer_tags`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `delivery_checklists`
--
ALTER TABLE `delivery_checklists`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `interactions`
--
ALTER TABLE `interactions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `interaction_logs`
--
ALTER TABLE `interaction_logs`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `leads`
--
ALTER TABLE `leads`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT de tabela `lead_distribution_rules`
--
ALTER TABLE `lead_distribution_rules`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `lead_distribution_state`
--
ALTER TABLE `lead_distribution_state`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `lead_notes`
--
ALTER TABLE `lead_notes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `lead_qualification`
--
ALTER TABLE `lead_qualification`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `lead_status_change_log`
--
ALTER TABLE `lead_status_change_log`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT de tabela `lead_tags`
--
ALTER TABLE `lead_tags`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `measurements`
--
ALTER TABLE `measurements`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `permissions`
--
ALTER TABLE `permissions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=81;

--
-- AUTO_INCREMENT de tabela `pipeline_stages`
--
ALTER TABLE `pipeline_stages`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=53;

--
-- AUTO_INCREMENT de tabela `projects`
--
ALTER TABLE `projects`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de tabela `project_documents`
--
ALTER TABLE `project_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `project_issues`
--
ALTER TABLE `project_issues`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `project_notes`
--
ALTER TABLE `project_notes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `project_tags`
--
ALTER TABLE `project_tags`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `quotes`
--
ALTER TABLE `quotes`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de tabela `quote_items`
--
ALTER TABLE `quote_items`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT de tabela `scheduled_followups`
--
ALTER TABLE `scheduled_followups`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT de tabela `users`
--
ALTER TABLE `users`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;

--
-- AUTO_INCREMENT de tabela `user_permissions`
--
ALTER TABLE `user_permissions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=49;

--
-- AUTO_INCREMENT de tabela `visits`
--
ALTER TABLE `visits`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `visit_attachments`
--
ALTER TABLE `visit_attachments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT de tabela `workflows`
--
ALTER TABLE `workflows`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Restrições para tabelas despejadas
--

--
-- Restrições para tabelas `activities`
--
ALTER TABLE `activities`
  ADD CONSTRAINT `activities_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `activities_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `activities_ibfk_3` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `assignment_history`
--
ALTER TABLE `assignment_history`
  ADD CONSTRAINT `assignment_history_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `assignment_history_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `assignment_history_ibfk_3` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `coupon_usage`
--
ALTER TABLE `coupon_usage`
  ADD CONSTRAINT `coupon_usage_ibfk_1` FOREIGN KEY (`coupon_id`) REFERENCES `coupons` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `coupon_usage_ibfk_2` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `coupon_usage_ibfk_3` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE SET NULL;

--
-- Restrições para tabelas `customers`
--
ALTER TABLE `customers`
  ADD CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL;

--
-- Restrições para tabelas `customer_notes`
--
ALTER TABLE `customer_notes`
  ADD CONSTRAINT `customer_notes_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `customer_tags`
--
ALTER TABLE `customer_tags`
  ADD CONSTRAINT `customer_tags_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `lead_notes`
--
ALTER TABLE `lead_notes`
  ADD CONSTRAINT `lead_notes_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `lead_tags`
--
ALTER TABLE `lead_tags`
  ADD CONSTRAINT `lead_tags_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `projects`
--
ALTER TABLE `projects`
  ADD CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE SET NULL;

--
-- Restrições para tabelas `project_notes`
--
ALTER TABLE `project_notes`
  ADD CONSTRAINT `project_notes_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `project_tags`
--
ALTER TABLE `project_tags`
  ADD CONSTRAINT `project_tags_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE;

--
-- Restrições para tabelas `user_permissions`
--
ALTER TABLE `user_permissions`
  ADD CONSTRAINT `user_permissions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `user_permissions_ibfk_2` FOREIGN KEY (`permission_id`) REFERENCES `permissions` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
