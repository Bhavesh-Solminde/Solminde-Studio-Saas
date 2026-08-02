-- Row-Level Security for every tenant-scoped table.
--
-- Application-layer `WHERE tenantId = ?` is not sufficient: one forgotten
-- clause and Salon A sees Salon B's customers, which is a business-ending bug.
-- These policies make that structurally impossible.
--
-- Three details that are easy to get wrong and fatal if missed:
--
-- 1. FORCE ROW LEVEL SECURITY. Plain ENABLE does not apply to the table's
--    OWNER, and Prisma connects as the owner. Without FORCE, every policy
--    below is silently inert.
--
-- 2. current_setting('app.tenant_id', true) — the second argument makes it
--    return NULL instead of raising when the setting is absent. NULL = uuid
--    evaluates to NULL, which is not true, so a query with no tenant context
--    returns zero rows. Fail closed, never fail open.
--
-- 3. Column identifiers are QUOTED. Prisma generates camelCase columns
--    ("tenantId"), and unquoted identifiers in Postgres fold to lowercase,
--    so an unquoted tenantId would look for a column named `tenantid` and
--    fail. Every raw query in this codebase must quote camelCase columns.
--
-- Applied by `pnpm --filter @salon/api rls:apply`, and re-applied idempotently.
-- It MUST be re-run after `prisma migrate reset`, which drops the policies
-- along with the tables.

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'locations', 'users', 'terminals', 'refresh_tokens',
    'tenant_features', 'audit_log',
    'service_categories', 'services', 'products', 'packages', 'package_items',
    'memberships',
    'customers', 'staff', 'attendance', 'resources', 'appointments',
    'bills', 'bill_lines', 'payments', 'expenses', 'invoice_leases', 'day_closes',
    'wallet_ledger', 'stock_ledger', 'session_ledger', 'customer_packages',
    'processed_ops', 'tombstones', 'sync_exceptions',
    'site_settings', 'site_sections', 'site_media',
    'user_permission_overrides'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t
    );
  END LOOP;
END $$;

-- The tenants table keys on `id` rather than `tenantId`.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

-- roles."tenantId" is nullable: NULL means a system role (Owner, Manager,
-- Front Desk, Stylist) that every tenant can read but nobody can modify.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roles;
CREATE POLICY tenant_isolation ON roles
  USING ("tenantId" = app_current_tenant() OR "tenantId" IS NULL)
  WITH CHECK ("tenantId" = app_current_tenant());

-- `features` is a global catalogue with no tenant dimension. Entitlement per
-- tenant lives in tenant_features, which IS protected above. Left readable.
