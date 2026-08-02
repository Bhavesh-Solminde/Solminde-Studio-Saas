import { useCallback, useEffect, useState } from 'react';
import { formatPaise } from '@salon/shared';
import { API, authHeaders } from './sync';
import { s } from './styles';

interface Feature {
  key: string;
  state: string;
}
interface ExceptionRow {
  id: string;
  type: string;
  detail: unknown;
  createdAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/api${path}`, { ...init, headers: authHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

/**
 * The owner's setup surface: entitlements, onboarding import, and the two
 * "something went sideways" trays. All server-side — these are configuration and
 * review, not the offline billing path.
 */
export function AdminView() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [csvKind, setCsvKind] = useState<'customers' | 'services' | 'products'>('customers');
  const [csvText, setCsvText] = useState('');
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [conflicts, setConflicts] = useState<ExceptionRow[]>([]);

  const refresh = useCallback(async () => {
    const [f, ex, cf] = await Promise.all([
      api<{ features: Feature[] }>('/admin/features'),
      api<{ rows: ExceptionRow[] }>('/ops/exceptions'),
      api<{ rows: ExceptionRow[] }>('/ops/conflicts'),
    ]);
    setFeatures(f.features);
    setExceptions(ex.rows);
    setConflicts(cf.rows);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setMessage('Could not load admin data.'));
  }, [refresh]);

  async function toggle(feature: Feature) {
    const enabling = feature.state !== 'enabled';
    // Before disabling Packages, show the outstanding liability so the owner is
    // not silently hiding a customer-facing debt.
    if (!enabling && feature.key === 'packages') {
      const lia = await api<{ customers: number; sessions: number; valuePaise: number }>(
        '/admin/features/packages/liability',
      );
      if (lia.sessions > 0) {
        const ok = window.confirm(
          `${lia.customers} customers hold ${lia.sessions} unused sessions worth ₹${formatPaise(lia.valuePaise)}. ` +
            `Disabling stops new sales; existing ones stay redeemable. Continue?`,
        );
        if (!ok) return;
      }
    }
    try {
      const res = await api<{ features: Feature[] }>(`/admin/features/${feature.key}`, {
        method: 'POST',
        body: JSON.stringify({ enabled: enabling }),
      });
      setFeatures(res.features);
      setMessage(null);
    } catch (e) {
      // Dependency violations come back as a 400 with a human message.
      setMessage(String(e).replace(/^Error:\s*/, '').slice(0, 200));
    }
  }

  async function runImport() {
    if (!csvText.trim()) return;
    const res = await api<{ imported: number; skipped: number }>(`/admin/import/${csvKind}`, {
      method: 'POST',
      body: JSON.stringify({ csv: csvText }),
    });
    setMessage(`Imported ${res.imported} ${csvKind}, skipped ${res.skipped}.`);
    setCsvText('');
  }

  async function resolve(id: string, status: string) {
    await api(`/ops/exceptions/${id}/resolve`, { method: 'POST', body: JSON.stringify({ status }) });
    await refresh();
  }

  return (
    <>
      <h1 style={s.title}>Setup</h1>
      {message && <div style={s.banner}>{message}</div>}

      <div style={s.columns}>
        <div style={s.panel}>
          <p style={s.panelTitle}>Features</p>
          {features.map((f) => (
            <div key={f.key} style={s.catalogRow}>
              <span>{f.key}</span>
              <button
                style={f.state === 'enabled' ? s.settled : s.ghost}
                onClick={() => void toggle(f)}
              >
                {f.state === 'enabled' ? 'On' : 'Off'}
              </button>
            </div>
          ))}
        </div>

        <div style={s.panel}>
          <p style={s.panelTitle}>Onboarding import (CSV)</p>
          <select
            style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
            value={csvKind}
            onChange={(e) => setCsvKind(e.target.value as typeof csvKind)}
          >
            <option value="customers">Customers (name, phone, email, notes)</option>
            <option value="services">Services (name, durationMin, price, taxRate)</option>
            <option value="products">Products (name, sku, cost, price, taxRate)</option>
          </select>
          <textarea
            style={{ ...s.input, width: '100%', boxSizing: 'border-box', marginTop: 8, height: 120, fontFamily: 'monospace' }}
            placeholder={'name,phone\nPriya,9812345678'}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <button style={{ ...s.primary, width: '100%', marginTop: 8 }} onClick={() => void runImport()}>
            Import
          </button>
        </div>
      </div>

      <h2 style={{ ...s.title, fontSize: 16, margin: '28px 0 12px' }}>
        Exceptions {exceptions.length > 0 && <span style={s.waiting}>{exceptions.length}</span>}
      </h2>
      <ExceptionTable rows={exceptions} onResolve={resolve} />

      <h2 style={{ ...s.title, fontSize: 16, margin: '28px 0 12px' }}>
        Conflicts {conflicts.length > 0 && <span style={s.waiting}>{conflicts.length}</span>}
      </h2>
      <ExceptionTable rows={conflicts} onResolve={resolve} />
    </>
  );
}

function ExceptionTable({
  rows,
  onResolve,
}: {
  rows: ExceptionRow[];
  onResolve: (id: string, status: string) => void;
}) {
  return (
    <table style={s.table}>
      <thead>
        <tr>
          <th style={s.th}>Type</th>
          <th style={s.th}>Detail</th>
          <th style={{ ...s.th, textAlign: 'right' }}></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={3} style={s.empty}>Nothing open — all clear.</td></tr>
        )}
        {rows.map((r) => (
          <tr key={r.id}>
            <td style={s.td}>{r.type}</td>
            <td style={{ ...s.td, fontSize: 12, color: 'var(--ink-muted)' }}>
              {JSON.stringify(r.detail)}
            </td>
            <td style={{ ...s.td, textAlign: 'right' }}>
              <button style={s.ghost} onClick={() => onResolve(r.id, 'resolved')}>Resolve</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
