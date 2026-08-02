import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '.env') });
import pg from 'pg';

/**
 * Applies prisma/sql/rls.sql.
 *
 * Runs against DIRECT_URL (unpooled), because DDL through Supavisor's
 * transaction pooler is unreliable. Idempotent — safe to re-run after every
 * migration, and it must be re-run, since `prisma migrate reset` drops the
 * policies along with the tables.
 */
const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, '..', 'prisma', 'sql', 'rls.sql');

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DIRECT_URL or DATABASE_URL must be set.');
  process.exit(1);
}

const sql = await readFile(sqlPath, 'utf8');
const client = new pg.Client({ connectionString });

await client.connect();
try {
  await client.query(sql);
  console.log('RLS policies applied.');
} finally {
  await client.end();
}
