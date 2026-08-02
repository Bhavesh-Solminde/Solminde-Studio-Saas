import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema='public' AND column_name IN ('tenant_id','tenantId')
  ORDER BY table_name`);
const snake = r.rows.filter(x => x.column_name === 'tenant_id').length;
const camel = r.rows.filter(x => x.column_name === 'tenantId').length;
console.log(`tenant_id (snake): ${snake} tables`);
console.log(`tenantId  (camel): ${camel} tables`);
const pол = await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'`);
console.log('policies:', pол.rows[0].n);
await c.end();
