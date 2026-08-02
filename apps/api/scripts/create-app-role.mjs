import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = join(here, '..', '..', '..', '.env');
loadEnv({ path: rootEnv });

/**
 * Creates (or re-passwords) the salon_app role and prints the connection URL
 * the API should use.
 *
 * Runs as postgres via DIRECT_URL, because creating a role is DDL. The role it
 * creates is NOBYPASSRLS, which is the entire point — see prisma/sql/app-role.sql.
 */
const admin = process.env.DIRECT_URL;
if (!admin) {
  console.error('DIRECT_URL must be set.');
  process.exit(1);
}

const password = randomBytes(24).toString('base64url');
const client = new pg.Client({ connectionString: admin, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'salon_app'`);

  if (exists.rowCount === 0) {
    const sql = await readFile(join(here, '..', 'prisma', 'sql', 'app-role.sql'), 'utf8');
    // node-postgres has no :'name' substitution, so bind the password by hand.
    await client.query(sql.replace(/:'password'/g, `'${password.replace(/'/g, "''")}'`));
    console.log('Created role salon_app (NOBYPASSRLS).');
  } else {
    await client.query(`ALTER ROLE salon_app WITH PASSWORD '${password.replace(/'/g, "''")}'`);
    await client.query(`ALTER ROLE salon_app NOBYPASSRLS NOSUPERUSER`);
    await client.query(`GRANT USAGE ON SCHEMA public TO salon_app`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salon_app`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salon_app`,
    );
    console.log('Role salon_app already existed — password rotated, grants refreshed.');
  }

  const verify = await client.query(
    `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'salon_app'`,
  );
  const row = verify.rows[0];
  if (row.rolbypassrls || row.rolsuper) {
    console.error('REFUSING: salon_app can bypass RLS. Tenant isolation would not hold.');
    process.exit(1);
  }
  console.log('Verified: salon_app has rolbypassrls=false, rolsuper=false.');

  const url = new URL(admin);
  const ref = url.username.split('.')[1];
  const appUser = ref ? `salon_app.${ref}` : 'salon_app';
  const poolerHost = url.hostname;

  console.log('\nSet DATABASE_URL to:\n');
  console.log(
    `postgresql://${appUser}:${encodeURIComponent(password)}@${poolerHost}:6543/postgres?pgbouncer=true`,
  );
} finally {
  await client.end();
}
