import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, pendingOpCount, requestPersistence } from './db';
import { createCustomer, startSyncWorker } from './sync';

/**
 * Stage 1 surface: customers end-to-end. One entity, taken all the way from an
 * offline write through the outbox to RLS-scoped Postgres and back down to a
 * second device.
 *
 * Built to DESIGN.md: blue means settled, yellow means waiting on you, flat
 * surfaces separated by hairlines, tabular figures, and no spinner anywhere —
 * every read and write here touches only Dexie.
 */
export function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const customers = useLiveQuery(() => db.customers.reverse().sortBy('updatedAt'), [], []);

  useEffect(() => {
    void requestPersistence();
    const stop = startSyncWorker();

    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);

    const poll = window.setInterval(() => {
      void pendingOpCount().then(setPending);
    }, 1000);

    return () => {
      stop();
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.clearInterval(poll);
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    // No await on the network, and no loading state. This resolves in a few
    // milliseconds because it only writes to IndexedDB.
    await createCustomer({ id: crypto.randomUUID(), name: name.trim(), phone: phone.trim() });
    setName('');
    setPhone('');
  }

  return (
    <div style={s.shell}>
      <header style={s.header}>
        <span style={s.wordmark}>Salon Platform</span>

        {/*
          Reserved well: connection state holds permanent space whether or not
          anything is wrong, so its appearance never reflows the screen.
        */}
        <div style={s.statusWell}>
          <span style={online ? s.settled : s.waiting}>{online ? 'Online' : 'Offline'}</span>
          <span style={s.meta}>
            {pending} pending {pending === 1 ? 'change' : 'changes'}
          </span>
        </div>
      </header>

      <main style={s.main}>
        <h1 style={s.title}>Customers</h1>

        <form onSubmit={submit} style={s.form}>
          <input
            style={s.input}
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Customer name"
          />
          <input
            style={s.input}
            placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label="Customer phone"
            inputMode="numeric"
          />
          <button type="submit" style={s.primary}>
            Add customer
          </button>
        </form>

        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Name</th>
              <th style={s.th}>Phone</th>
              <th style={{ ...s.th, textAlign: 'right' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {customers.length === 0 && (
              <tr>
                <td colSpan={3} style={s.empty}>
                  No customers yet. Add one above — it works with the internet off.
                </td>
              </tr>
            )}
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td style={s.td}>{customer.name}</td>
                <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{customer.phone}</td>
                <td style={{ ...s.td, textAlign: 'right' }}>
                  {/* Colour is never the only signal — the label carries it too. */}
                  <span style={customer.pending ? s.waiting : s.settled}>
                    {customer.pending ? 'Pending sync' : 'Synced'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}

// Inline styles remain a Stage 1 placeholder; token plumbing lands with the
// billing screen in Stage 2. Values track DESIGN.md's committed palette.
const s: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', height: '100%' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    padding: '12px 20px',
    background: 'var(--panel)',
    borderBottom: '1px solid var(--hairline)',
  },
  wordmark: { fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em' },
  statusWell: { display: 'flex', alignItems: 'center', gap: 12, minHeight: 24 },
  settled: {
    padding: '3px 9px',
    background: 'var(--blue-wash)',
    color: 'var(--signal-blue)',
    fontSize: 12,
    fontWeight: 600,
  },
  waiting: {
    padding: '3px 9px',
    background: 'var(--yellow-wash)',
    color: 'var(--ink)',
    fontSize: 12,
    fontWeight: 600,
  },
  meta: { fontSize: 12, color: 'var(--ink-muted)' },
  main: { padding: '28px 20px', maxWidth: 880 },
  title: { fontSize: 22, fontWeight: 600, margin: '0 0 18px', letterSpacing: '-0.02em' },
  form: { display: 'flex', gap: 8, marginBottom: 28 },
  input: {
    flex: '0 1 220px',
    padding: '9px 11px',
    fontSize: 14,
    color: 'var(--ink)',
    background: 'var(--panel)',
    border: '1px solid var(--hairline)',
    borderRadius: 3,
  },
  primary: {
    padding: '9px 18px',
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    background: 'var(--signal-blue)',
    border: 'none',
    borderRadius: 3,
    cursor: 'pointer',
  },
  table: { width: '100%', borderCollapse: 'collapse', background: 'var(--panel)' },
  th: {
    padding: '9px 12px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--ink-muted)',
    textAlign: 'left',
    borderBottom: '1px solid var(--hairline)',
  },
  td: { padding: '11px 12px', fontSize: 14, borderBottom: '1px solid var(--hairline)' },
  empty: { padding: '28px 12px', fontSize: 14, color: 'var(--ink-muted)', textAlign: 'center' },
};
