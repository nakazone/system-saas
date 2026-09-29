-- Defense in depth: FORCE RLS on job media / report models that only had ENABLE.
-- Without FORCE, table-owner DB roles (typical production DATABASE_URL) bypass RLS.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'JobMedia',
    'JobReport',
    'JobInspection',
    'JobInspectionMark',
    'JobMeasurement',
    'ChatConversation',
    'ChatConversationMember',
    'ChatConversationContext',
    'ChatMessage',
    'ChatMessageEdit',
    'ChatMessageJob',
    'ChatMessageMention',
    'ChatAttachment',
    'ChatAuditLog',
    'ChatMessageFlag'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I
           USING ("organizationId"::text = current_setting(''app.current_tenant_id'', true))
           WITH CHECK ("organizationId"::text = current_setting(''app.current_tenant_id'', true))',
        tbl
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
