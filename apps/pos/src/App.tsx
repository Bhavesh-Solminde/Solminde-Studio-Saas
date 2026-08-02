import { useEffect, useState } from 'react';
import { pendingOpCount, requestPersistence } from './db';

/**
 * Stage 0 shell. No features — this exists to prove the app boots and to hold
 * the two pieces of permanent chrome the spec requires from day one:
 * connection state and the pending-op count.
 */
export function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void requestPersistence();

    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);

    let cancelled = false;
    void pendingOpCount().then((count) => {
      if (!cancelled) setPending(count);
    });

    return () => {
      cancelled = true;
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <div style={styles.shell}>
      <header style={styles.header}>
        <span style={styles.wordmark}>Salon Platform</span>

        {/*
          Reserved well. DESIGN.md: connection state holds permanent header space
          whether or not anything is wrong, so its appearance never reflows the
          billing screen mid-transaction.
        */}
        <div style={styles.statusWell}>
          <span style={online ? styles.statusSettled : styles.statusWaiting}>
            {online ? 'Online' : 'Offline'}
          </span>
          <span style={styles.pending}>
            {pending} {pending === 1 ? 'bill' : 'bills'} pending sync
          </span>
        </div>
      </header>

      <main style={styles.main}>
        <h1 style={styles.title}>Stage 0</h1>
        <p style={styles.body}>
          Rails only. The workspace builds, the shell boots with no server, and the outbox is
          open for writes. Stage 1 adds the sync foundation.
        </p>
      </main>
    </div>
  );
}

// Inline styles are a Stage 0 placeholder. Real token plumbing lands with the
// first actual screen; see DESIGN.md.
const styles: Record<string, React.CSSProperties> = {
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
  statusSettled: {
    padding: '3px 9px',
    background: 'var(--blue-wash)',
    color: 'var(--signal-blue)',
    fontSize: 12,
    fontWeight: 600,
  },
  statusWaiting: {
    padding: '3px 9px',
    background: 'var(--yellow-wash)',
    color: 'var(--ink)',
    fontSize: 12,
    fontWeight: 600,
  },
  pending: { fontSize: 12, color: 'var(--ink-muted)' },
  main: { padding: '40px 20px', maxWidth: 640 },
  title: { fontSize: 26, fontWeight: 600, margin: '0 0 10px', letterSpacing: '-0.02em' },
  body: { fontSize: 14, lineHeight: 1.6, color: 'var(--ink-muted)', margin: 0 },
};
