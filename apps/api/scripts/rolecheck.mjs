import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const r = await c.query(`
  SELECT current_user,
         rolsuper, rolbypassrls
  FROM pg_roles WHERE rolname = current_user`);
console.log(r.rows[0]);
const t = await c.query(`
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname='customers'`);
console.log(t.rows[0]);
// Does the policy actually filter for THIS role?
await c.query(`SELECT set_config('app.tenant_id', '22222222-2222-4222-8222-222222222222', false)`);
const q = await c.query(`SELECT count(*)::int n FROM customers`);
console.log('customers visible as rival tenant:', q.rows[0].n, '(expected 0)');
await c.end();
