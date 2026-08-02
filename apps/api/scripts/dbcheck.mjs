import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const tables = await c.query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1`);
let total = 0;
for (const { table_name } of tables.rows) {
  const r = await c.query(`SELECT count(*)::int AS n FROM "${table_name}"`);
  if (r.rows[0].n > 0) console.log(`  ${table_name}: ${r.rows[0].n} rows`);
  total += r.rows[0].n;
}
console.log(`tables: ${tables.rows.length}, total rows across all tables: ${total}`);
await c.end();
