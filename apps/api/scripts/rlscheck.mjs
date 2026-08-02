import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const r = await c.query(`
  SELECT relname,
         relrowsecurity  AS enabled,
         relforcerowsecurity AS forced
  FROM pg_class
  WHERE relnamespace = 'public'::regnamespace AND relkind='r'
  ORDER BY relname`);

const missing = r.rows.filter(t => t.relname !== '_prisma_migrations' && (!t.enabled || !t.forced));
console.log(`tables: ${r.rows.length}`);
console.log(`RLS enabled+forced: ${r.rows.filter(t=>t.enabled&&t.forced).length}`);
if (missing.length) {
  console.log('NOT PROTECTED:', missing.map(m => `${m.relname}(enabled=${m.enabled},forced=${m.forced})`).join(', '));
} else {
  console.log('every table protected (features/_prisma_migrations aside)');
}

const pol = await c.query(`SELECT count(*)::int n FROM pg_policies WHERE schemaname='public'`);
console.log('policies:', pol.rows[0].n);
await c.end();
