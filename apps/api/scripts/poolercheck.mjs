import pg from 'pg';
const ref = 'jsvxwmzmlcuztoejwffm';
const pass = new URL(process.env.DIRECT_URL).password; // already percent-encoded
const candidates = [
  ['aws-0-ap-south-1.pooler.supabase.com', 6543, 'transaction'],
  ['aws-1-ap-south-1.pooler.supabase.com', 6543, 'transaction'],
  ['aws-0-ap-south-1.pooler.supabase.com', 5432, 'session'],
  ['aws-1-ap-south-1.pooler.supabase.com', 5432, 'session'],
];
for (const [host, port, mode] of candidates) {
  const url = `postgresql://postgres.${ref}:${pass}@${host}:${port}/postgres`;
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await c.connect();
    const r = await c.query('select current_user, inet_server_port()');
    console.log(`OK   ${host}:${port} (${mode}) user=${r.rows[0].current_user}`);
  } catch (e) {
    console.log(`FAIL ${host}:${port} (${mode}) ${e.code ?? ''} ${e.message.slice(0, 70)}`);
  } finally { await c.end().catch(() => {}); }
}
