import { useCallback, useEffect, useState } from 'react';
import { formatPaise } from '@salon/shared';
import { API, authHeaders } from './sync';
import { s } from './styles';

const rupees = (p: number) => `₹${formatPaise(p)}`;

interface StylistRow {
  staffId: string;
  displayName: string;
  services: number;
  retail: number;
  total: number;
}
interface GstRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

function monthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

/**
 * Reports read straight from the server — they are aggregations over data the
 * offline surfaces already synced, so they need the network and say so by simply
 * being a normal fetch. Every report offers a CSV download for the owner's
 * accountant.
 */
export function ReportsView() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [stylists, setStylists] = useState<StylistRow[]>([]);
  const [gst, setGst] = useState<{ byRate: GstRow[]; totals: GstRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = `from=${from}&to=${to}T23:59:59`;
    try {
      const [rev, g] = await Promise.all([
        fetch(`${API}/api/reports/revenue-by-stylist?${q}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/reports/gst?${q}`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setStylists(rev.rows ?? []);
      setGst(g.byRate ? { byRate: g.byRate, totals: g.totals } : null);
    } catch {
      setError('Could not load reports — check the connection.');
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  function download(report: string) {
    const url = `${API}/api/reports/${report}?from=${from}&to=${to}T23:59:59&format=csv`;
    // Fetch with auth, then save the blob — the endpoint needs the bearer token.
    void fetch(url, { headers: authHeaders() })
      .then((r) => r.blob())
      .then((blob) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${report}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
  }

  return (
    <>
      <h1 style={s.title}>Reports</h1>
      {error && <div style={s.banner}>{error}</div>}

      <div style={{ ...s.form, alignItems: 'flex-end' }}>
        <div>
          <label style={s.label}>From</label>
          <input style={s.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label style={s.label}>To</label>
          <input style={s.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button style={s.primary} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 8px' }}>
        <h2 style={{ ...s.title, fontSize: 16, margin: 0 }}>Revenue per stylist</h2>
        <button style={s.ghost} onClick={() => download('revenue-by-stylist')}>Export CSV</button>
      </div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Stylist</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Services</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Retail</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {stylists.length === 0 && (
            <tr><td colSpan={4} style={s.empty}>No revenue in this range.</td></tr>
          )}
          {stylists.map((r) => (
            <tr key={r.staffId}>
              <td style={s.td}>{r.displayName}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.services)}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.retail)}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '28px 0 8px' }}>
        <h2 style={{ ...s.title, fontSize: 16, margin: 0 }}>GST summary</h2>
        <button style={s.ghost} onClick={() => download('gst')}>Export CSV</button>
      </div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Rate</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Taxable</th>
            <th style={{ ...s.th, textAlign: 'right' }}>CGST</th>
            <th style={{ ...s.th, textAlign: 'right' }}>SGST</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(!gst || gst.byRate.length === 0) && (
            <tr><td colSpan={5} style={s.empty}>No taxable sales in this range.</td></tr>
          )}
          {gst?.byRate.map((r) => (
            <tr key={r.rate}>
              <td style={s.td}>{r.rate}%</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.taxable)}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.cgst)}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.sgst)}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
