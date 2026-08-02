-- Authentication lookups.
--
-- THE PROBLEM: login has to find a tenant and a user BEFORE any tenant context
-- exists — that is what login is for. But RLS fails closed, so an ordinary
-- query returns zero rows and every login fails.
--
-- THE WRONG FIXES, for the record:
--   * connecting as a BYPASSRLS role — disables isolation everywhere
--   * a policy like "visible when app.tenant_id is not set" — an attacker who
--     can reach the database with no context then reads every salon's data
--
-- THE FIX: two SECURITY DEFINER functions with a fixed search_path. They run
-- as their owner (postgres) and so see through RLS, but each returns only the
-- specific columns authentication needs, for one exact credential lookup.
-- The surface is two functions instead of the whole schema.

CREATE OR REPLACE FUNCTION app_login_lookup(p_slug text, p_phone text)
RETURNS TABLE (
  tenant_id     uuid,
  user_id       uuid,
  role_id       uuid,
  password_hash text,
  status        text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.id, u.id, u."roleId", u."passwordHash", u.status
  FROM tenants t
  JOIN users u ON u."tenantId" = t.id
  WHERE t.slug = p_slug
    AND u.phone = p_phone
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_refresh_lookup(p_token_hash text)
RETURNS TABLE (
  tenant_id  uuid,
  user_id    uuid,
  role_id    uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  status     text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT r."tenantId", r."userId", u."roleId", r."expiresAt", r."revokedAt", u.status
  FROM refresh_tokens r
  JOIN users u ON u.id = r."userId"
  WHERE r."tokenHash" = p_token_hash
  LIMIT 1;
$$;

-- The public booking page has no login and therefore no tenant context, but it
-- must resolve a salon from its slug to show services and take a booking. Same
-- fail-closed problem as login, same narrow fix: one SECURITY DEFINER function
-- that returns only the handful of non-sensitive fields a public site needs.
CREATE OR REPLACE FUNCTION app_public_tenant(p_slug text)
RETURNS TABLE (
  tenant_id uuid,
  name      text,
  timezone  text,
  status    text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.id, t.name, t.timezone, t.status
  FROM tenants t
  WHERE t.slug = p_slug
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_login_lookup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_refresh_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_public_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_login_lookup(text, text) TO salon_app;
GRANT EXECUTE ON FUNCTION app_refresh_lookup(text) TO salon_app;
GRANT EXECUTE ON FUNCTION app_public_tenant(text) TO salon_app;
