-- Senior Floors System - Database Schema
-- Execute este SQL no seu banco MySQL (Hostinger, Railway MySQL, etc.)

CREATE TABLE IF NOT EXISTS `leads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `phone` varchar(50) NOT NULL,
  `zipcode` varchar(10) NOT NULL,
  `message` text DEFAULT NULL,
  `source` varchar(100) DEFAULT NULL COMMENT 'LP-Hero, LP-Contact, etc.',
  `form_type` varchar(50) DEFAULT NULL COMMENT 'hero-form, contact-form, etc.',
  `status` varchar(50) DEFAULT 'new' COMMENT 'new, contacted, qualified, converted, lost',
  `priority` varchar(50) DEFAULT 'medium' COMMENT 'low, medium, high',
  `ip_address` varchar(45) DEFAULT NULL,
  `owner_id` int(11) DEFAULT NULL COMMENT 'ID do usuário responsável (opcional)',
  `pipeline_stage_id` int(11) DEFAULT NULL COMMENT 'ID do estágio no pipeline (opcional)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_email` (`email`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_owner_id` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabela de usuários (opcional, para owner_id)
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) DEFAULT NULL COMMENT 'hash bcrypt',
  `role` varchar(50) DEFAULT 'user' COMMENT 'admin, user',
  `active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
