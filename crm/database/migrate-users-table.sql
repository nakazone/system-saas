-- Migração: atualizar tabela users do schema básico para o completo
-- Execute este SQL ANTES de executar schema-completo.sql se você já tem a tabela users

-- Renomear 'active' para 'is_active' se existir
ALTER TABLE `users` 
  CHANGE COLUMN `active` `is_active` tinyint(1) DEFAULT 1 COMMENT '1=ativo, 0=inativo';

-- Adicionar colunas faltantes (ignora erro se já existirem)
ALTER TABLE `users` 
  ADD COLUMN IF NOT EXISTS `phone` varchar(50) DEFAULT NULL AFTER `is_active`,
  ADD COLUMN IF NOT EXISTS `avatar` varchar(500) DEFAULT NULL COMMENT 'URL da foto do perfil' AFTER `phone`,
  ADD COLUMN IF NOT EXISTS `last_login_at` timestamp NULL DEFAULT NULL AFTER `avatar`;

-- Adicionar índices (ignora erro se já existirem)
ALTER TABLE `users` 
  ADD INDEX IF NOT EXISTS `idx_role` (`role`),
  ADD INDEX IF NOT EXISTS `idx_is_active` (`is_active`);
