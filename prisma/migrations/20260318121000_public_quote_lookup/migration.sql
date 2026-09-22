-- Public quote lookup must work without a tenant subdomain.
-- SECURITY DEFINER bypasses RLS for this narrow token-based read only.

CREATE OR REPLACE FUNCTION get_quote_org_by_public_token(token text)
RETURNS TABLE(quote_id uuid, organization_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, "organizationId"
  FROM "Quote"
  WHERE "publicToken" = token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_quote_org_by_public_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_quote_org_by_public_token(text) TO app_user;
