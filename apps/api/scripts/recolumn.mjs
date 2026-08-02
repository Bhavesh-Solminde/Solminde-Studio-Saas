import { readFile } from 'node:fs/promises';
import pg from 'pg';

/**
 * One-off: rename columns while RLS policies depend on them.
 *
 * Policies reference the tenant column, so Postgres refuses to alter it while
 * they exist. Drop them, apply the migration, then recreate from rls.sql —
 * which is idempotent and is the single source of truth for the policies.
 */
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const policies = await c.query(
  `SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public'`,
);
for (const p of policies.rows) {
  await c.query(`DROP POLICY IF EXISTS "${p.policyname}" ON "${p.tablename}"`);
}
console.log(`dropped ${policies.rows.length} policies`);

const migration = await readFile(process.argv[2], 'utf8');
await c.query(migration);
console.log('migration applied');

const rls = await readFile('prisma/sql/rls.sql', 'utf8');
await c.query(rls);
console.log('rls.sql re-applied');

await c.end();
