import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(here, '..', '..', '..', '.env') });

/**
 * Proves tenant isolation is actually in force at the database level.
 *
 * Run after every migration and before any deploy. Each check below has
 * already failed silently once during this project, and none of them announce
 * themselves — the first real symptom is a client seeing another salon's data.
 */
const failures = [];
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  failures.push(m);
};

const appUrl = process.env.DATABASE_URL;
const adminUrl = process.env.DIRECT_URL;
if (!appUrl || !adminUrl) {
  console.error('DATABASE_URL and DIRECT_URL must both be set.');
  process.exit(1);
}

const app = new pg.Client({ connectionString: appUrl, ssl: { rejectUnauthorized: false } });
await app.connect();

console.log('\nApplication role');
const role = await app.query(
  `SELECT current_user AS name, rolsuper, rolbypassrls
   FROM pg_roles WHERE rolname = current_user`,
);
const r = role.rows[0];
console.log(`  connected as ${r.name}`);
// The one that actually bit: a BYPASSRLS role ignores every policy, including
// tables marked FORCE ROW LEVEL SECURITY, and nothing appears to be wrong.
if (r.rolbypassrls) bad('role can BYPASS RLS — isolation does not hold');
else ok('rolbypassrls = false');
if (r.rolsuper) bad('role is SUPERUSER — bypasses RLS');
else ok('rolsuper = false');

console.log('\nPolicies');
const admin = new pg.Client({ connectionString: adminUrl, ssl: { rejectUnauthorized: false } });
await admin.connect();
const tables = await admin.query(
  `SELECT relname, relrowsecurity, relforcerowsecurity
   FROM pg_class
   WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
     AND relname NOT IN ('_prisma_migrations', 'features')
   ORDER BY relname`,
);
const unprotected = tables.rows.filter((t) => !t.relrowsecurity || !t.relforcerowsecurity);
if (unprotected.length === 0) ok(`all ${tables.rows.length} tenant tables ENABLEd and FORCEd`);
else bad(`not protected: ${unprotected.map((t) => t.relname).join(', ')}`);

console.log('\nActual visibility');

// Clear any session-level value first. A pooled backend can still be carrying
// one from something that wrongly called set_config with is_local = false —
// which is the leak this script exists to catch, and which would otherwise
// make the "no context" check below report a false failure.
await app.query(`SELECT set_config('app.tenant_id', '', false)`);

// With no tenant context at all, the app must see nothing.
const blind = await app.query('SELECT count(*)::int AS n FROM customers');
if (blind.rows[0].n === 0) ok('no tenant context returns zero rows (fails closed)');
else bad(`no tenant context returned ${blind.rows[0].n} rows — policies are not applying`);

const tenants = await admin.query('SELECT id FROM tenants ORDER BY id LIMIT 2');
if (tenants.rows.length === 2) {
  const [a] = tenants.rows;

  // set_config's third argument MUST be true (transaction-local). With false
  // the setting is session-level, and under a transaction pooler it survives
  // on the backend and leaks into whichever request borrows that connection
  // next — one salon's id silently scoping another salon's queries.
  // This script learned that the hard way; do not "simplify" it.
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.id]);
  const leaked = await app.query(
    'SELECT count(*)::int AS n FROM customers WHERE "tenantId" <> $1',
    [a.id],
  );
  if (leaked.rows[0].n === 0) ok('scoped to tenant A, zero rows from tenant B are visible');
  else bad(`tenant A can see ${leaked.rows[0].n} of tenant B's rows`);
  await app.query('COMMIT');

  // And the setting must be gone the moment that transaction ended.
  const after = await app.query(
    `SELECT coalesce(nullif(current_setting('app.tenant_id', true), ''), '') AS v`,
  );
  if (after.rows[0].v === '') ok('tenant id does not survive the transaction (no pooler leak)');
  else bad(`tenant id leaked past its transaction: ${after.rows[0].v}`);
} else {
  console.log('  skip  needs two seeded tenants');
}

await app.end();
await admin.end();

console.log(
  failures.length === 0
    ? '\nTenant isolation verified.\n'
    : `\n${failures.length} check(s) FAILED. Do not deploy.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
