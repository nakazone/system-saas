-- Reverse of 20260928200000_chat_internal
-- Run manually if you need to roll back (Prisma does not auto-apply down.sql).

DROP INDEX IF EXISTS "ChatMessage_body_fts_idx";

DROP TABLE IF EXISTS "ChatMessageFlag";
DROP TABLE IF EXISTS "ChatAuditLog";
DROP TABLE IF EXISTS "ChatAttachment";
DROP TABLE IF EXISTS "ChatMessageMention";
DROP TABLE IF EXISTS "ChatMessageJob";
DROP TABLE IF EXISTS "ChatMessageEdit";
DROP TABLE IF EXISTS "ChatMessage";
DROP TABLE IF EXISTS "ChatConversationContext";
DROP TABLE IF EXISTS "ChatConversationMember";
DROP TABLE IF EXISTS "ChatConversation";
