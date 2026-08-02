-- The application database role.
--
-- WHY THIS EXISTS — read before changing the connection string.
--
-- Supabase's default `postgres` role has rolbypassrls = true. A role with
-- BYPASSRLS ignores every row-level security policy, including tables marked
-- FORCE ROW LEVEL SECURITY. Connecting the API as `postgres` therefore
-- disables tenant isolation completely, and NOTHING VISIBLY BREAKS: every
-- query still succeeds, every test that only checks happy paths still passes,
-- and the first symptom is a client seeing another salon's customers.
--
-- So the running application connects as `salon_app`, which is deliberately
-- NOBYPASSRLS and is not the owner of any table. Migrations and DDL continue
-- to run as `postgres` via DIRECT_URL, because they must.
--
-- The regression test for this is tests/bruno/07-tenant-isolation-pull.bru.
-- If that test ever passes while the API is connected as postgres, the test
-- is lying.

-- :password is substituted by scripts/create-app-role.mjs
CREATE ROLE salon_app WITH LOGIN PASSWORD :'password' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;

GRANT USAGE ON SCHEMA public TO salon_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salon_app;

-- Tables created by future migrations must be reachable too, without having to
-- remember to re-grant every time.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO salon_app;

-- Deliberately NOT granted: TRUNCATE, REFERENCES, TRIGGER, or ownership of
-- anything. The application never needs them, and ownership would re-open the
-- RLS hole this role exists to close.
