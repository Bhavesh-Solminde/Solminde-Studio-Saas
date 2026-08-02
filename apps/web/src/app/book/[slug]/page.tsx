'use client';

import { use, useEffect, useState } from 'react';

/**
 * Public online booking — the page that converts a customer for the salon.
 *
 * A client component on purpose: it talks straight to the booking API, whose
 * availability is "live", so a slot disappears the moment it is taken on any
 * surface. The salon is resolved from the route slug (`/book/acme-salon`); the
 * API needs no login for these routes.
 */
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Service {
  id: string;
  name: string;
  durationMin: number;
  price: number;
}
interface Slot {
  startAt: string;
  endAt: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`${API}/api/public/${slug}/services`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Service[]) => {
        setServices(list);
        if (list[0]) setServiceId(list[0].id);
      })
      .catch(() => setError('Could not reach the salon. Try again shortly.'));
  }, [slug]);

  useEffect(() => {
    if (!serviceId || !date) return;
    setSlot('');
    void fetch(`${API}/api/public/${slug}/availability?serviceId=${serviceId}&date=${date}`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((body: { slots: Slot[] }) => setSlots(body.slots))
      .catch(() => setSlots([]));
  }, [slug, serviceId, date, confirmed]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${API}/api/public/${slug}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerName: name, customerPhone: phone, serviceId, startAt: slot }),
    });
    if (!res.ok) {
      setError('That slot could not be booked. Please pick another.');
      return;
    }
    setConfirmed(slot);
    setName('');
    setPhone('');
    setSlot('');
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  return (
    <main style={t.shell}>
      <h1 style={t.h1}>Book an appointment</h1>

      {confirmed && (
        <div style={t.confirm}>
          Booked for {new Date(confirmed).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.
          A WhatsApp confirmation is on its way.
        </div>
      )}
      {error && <div style={t.error}>{error}</div>}

      <form onSubmit={submit} style={t.form}>
        <label style={t.label}>Service</label>
        <select style={t.input} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((svc) => (
            <option key={svc.id} value={svc.id}>
              {svc.name} · {svc.durationMin} min · ₹{(svc.price / 100).toLocaleString('en-IN')}
            </option>
          ))}
        </select>

        <label style={t.label}>Date</label>
        <input style={t.input} type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} />

        <label style={t.label}>Time</label>
        <div style={t.slots}>
          {slots.length === 0 && <span style={t.muted}>No slots available on this day.</span>}
          {slots.map((sl) => (
            <button
              type="button"
              key={sl.startAt}
              onClick={() => setSlot(sl.startAt)}
              style={{ ...t.slot, ...(slot === sl.startAt ? t.slotActive : {}) }}
            >
              {fmt(sl.startAt)}
            </button>
          ))}
        </div>

        <label style={t.label}>Your name</label>
        <input style={t.input} value={name} onChange={(e) => setName(e.target.value)} required />

        <label style={t.label}>Phone</label>
        <input style={t.input} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" required />

        <button type="submit" style={t.submit} disabled={!slot || !name || !phone}>
          Confirm booking
        </button>
      </form>
    </main>
  );
}

const t: Record<string, React.CSSProperties> = {
  shell: { maxWidth: 480, margin: '0 auto', padding: '40px 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1d21' },
  h1: { fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 20px' },
  form: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: '#5a626b', marginTop: 14 },
  input: { padding: '10px 12px', fontSize: 15, border: '1px solid #d9dee3', borderRadius: 6, background: '#fff' },
  slots: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  slot: { padding: '8px 12px', fontSize: 14, border: '1px solid #d9dee3', borderRadius: 6, background: '#fff', cursor: 'pointer' },
  slotActive: { background: '#0f5da8', color: '#fff', borderColor: '#0f5da8' },
  muted: { fontSize: 14, color: '#5a626b' },
  submit: { marginTop: 22, padding: '12px 16px', fontSize: 15, fontWeight: 600, color: '#fff', background: '#0f5da8', border: 'none', borderRadius: 6, cursor: 'pointer' },
  confirm: { padding: '12px 14px', background: '#e8f0fa', color: '#0f5da8', borderRadius: 6, fontSize: 14, marginBottom: 16 },
  error: { padding: '12px 14px', background: '#fdecea', color: '#b3261e', borderRadius: 6, fontSize: 14, marginBottom: 16 },
};
