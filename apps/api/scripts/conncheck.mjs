import pg from 'pg';
const url = process.env.DIRECT_URL;
if (!url) { console.log('DIRECT_URL missing'); process.exit(1); }
const u = new URL(url);
console.log('host:', u.hostname, 'port:', u.port);
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
try {
  await c.connect();
  const r = await c.query('select version(), current_user, current_database()');
  console.log('CONNECTED as', r.rows[0].current_user, '/', r.rows[0].current_database);
  console.log(r.rows[0].version.split(' on ')[0]);
} catch (e) {
  console.log('FAILED:', e.code ?? '', e.message);
} finally { await c.end().catch(() => {}); }
