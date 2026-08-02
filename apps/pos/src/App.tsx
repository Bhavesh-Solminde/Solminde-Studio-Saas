import { useEffect, useState } from 'react';
import { pendingOpCount, requestPersistence } from './db';
import { startSyncWorker } from './sync';
import { CustomersView } from './CustomersView';
import { BillingView } from './BillingView';
import { AppointmentsView } from './AppointmentsView';
import { ReportsView } from './ReportsView';
import { AdminView } from './AdminView';
import { s } from './styles';

type Tab = 'billing' | 'appointments' | 'customers' | 'reports' | 'admin';

/**
 * The POS shell: a permanent connection badge, a pending-sync counter, and two
 * surfaces — Billing (the Stage 2 revenue surface) and Customers (Stage 1).
 *
 * Built to DESIGN.md: blue means settled, yellow means waiting on you, flat
 * surfaces separated by hairlines, tabular figures, and no spinner anywhere —
 * every read and write in either surface touches only Dexie.
 */
export function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [tab, setTab] = useState<Tab>('billing');

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

      <nav style={s.nav}>
        <button
          style={{ ...s.tab, ...(tab === 'billing' ? s.tabActive : {}) }}
          onClick={() => setTab('billing')}
        >
          Billing
        </button>
        <button
          style={{ ...s.tab, ...(tab === 'appointments' ? s.tabActive : {}) }}
          onClick={() => setTab('appointments')}
        >
          Appointments
        </button>
        <button
          style={{ ...s.tab, ...(tab === 'customers' ? s.tabActive : {}) }}
          onClick={() => setTab('customers')}
        >
          Customers
        </button>
        <button
          style={{ ...s.tab, ...(tab === 'reports' ? s.tabActive : {}) }}
          onClick={() => setTab('reports')}
        >
          Reports
        </button>
        <button
          style={{ ...s.tab, ...(tab === 'admin' ? s.tabActive : {}) }}
          onClick={() => setTab('admin')}
        >
          Setup
        </button>
      </nav>

      <main style={s.main}>
        {tab === 'billing' && <BillingView />}
        {tab === 'appointments' && <AppointmentsView />}
        {tab === 'customers' && <CustomersView />}
        {tab === 'reports' && <ReportsView />}
        {tab === 'admin' && <AdminView />}
      </main>
    </div>
  );
}
