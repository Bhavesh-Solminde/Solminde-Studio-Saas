import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LocalCustomer } from './db';
import { bookAppointment, cancelAppointment } from './appointments';
import { s } from './styles';

/**
 * The appointment book. Reads only from Dexie, so it shows the day instantly and
 * works with the network down. Appointments booked online arrive on the next
 * pull and appear here automatically — which is how an online booking blocks the
 * slot on the front desk's screen.
 */
export function AppointmentsView() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [when, setWhen] = useState('');

  const services = useLiveQuery(() => db.services.toArray(), [], []);
  const appointments = useLiveQuery(
    () => db.appointments.orderBy('startAt').toArray(),
    [],
    [],
  );
  const customers = useLiveQuery(
    () =>
      search.trim()
        ? db.customers
            .filter((c) => c.phone.includes(search) || c.name.toLowerCase().includes(search.toLowerCase()))
            .limit(6)
            .toArray()
        : Promise.resolve<LocalCustomer[]>([]),
    [search],
    [] as LocalCustomer[],
  );
  const selected = useLiveQuery(
    () => (customerId ? db.customers.get(customerId) : undefined),
    [customerId],
  );

  const serviceById = useMemo(() => new Map(services.map((svc) => [svc.id, svc])), [services]);

  async function book() {
    if (!customerId || !serviceId || !when) return;
    const svc = serviceById.get(serviceId);
    const startAt = new Date(when).getTime();
    const endAt = startAt + (svc?.durationMin ?? 30) * 60_000;
    await bookAppointment({ customerId, serviceId, startAt, endAt });
    setCustomerId(null);
    setSearch('');
    setServiceId('');
    setWhen('');
  }

  const upcoming = appointments.filter((a) => a.status === 'booked');

  return (
    <>
      <h1 style={s.title}>Appointments</h1>

      <div style={s.columns}>
        <div style={s.panel}>
          <p style={s.panelTitle}>New booking</p>
          <label style={s.label}>Customer</label>
          <input
            style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
            placeholder={selected ? selected.name : 'Search phone or name'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Customer search"
          />
          {customers.map((c) => (
            <div key={c.id} style={s.catalogRow} onClick={() => { setCustomerId(c.id); setSearch(''); }}>
              <span>{c.name}</span>
              <span style={s.meta}>{c.phone}</span>
            </div>
          ))}

          <label style={{ ...s.label, marginTop: 12 }}>Service</label>
          <select
            style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            aria-label="Service"
          >
            <option value="">Select a service</option>
            {services.map((svc) => (
              <option key={svc.id} value={svc.id}>
                {svc.name} ({svc.durationMin} min)
              </option>
            ))}
          </select>

          <label style={{ ...s.label, marginTop: 12 }}>When</label>
          <input
            style={{ ...s.input, width: '100%', boxSizing: 'border-box' }}
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            aria-label="Appointment time"
          />

          <button
            style={{ ...s.primary, width: '100%', marginTop: 14 }}
            onClick={book}
            disabled={!customerId || !serviceId || !when}
          >
            Book
          </button>
        </div>

        <div style={{ ...s.panel, flex: '2 1 420px' }}>
          <p style={s.panelTitle}>Upcoming</p>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>When</th>
                <th style={s.th}>Service</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Source</th>
                <th style={{ ...s.th, textAlign: 'right' }}>Sync</th>
                <th style={s.th}></th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td colSpan={5} style={s.empty}>No appointments. Book one, or wait for an online booking to arrive.</td>
                </tr>
              )}
              {upcoming.map((a) => (
                <tr key={a.id}>
                  <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>
                    {new Date(a.startAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td style={s.td}>{serviceById.get(a.serviceId)?.name ?? '—'}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>{a.source}</td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <span style={a.pending ? s.waiting : s.settled}>{a.pending ? 'Pending' : 'Synced'}</span>
                  </td>
                  <td style={{ ...s.td, textAlign: 'right' }}>
                    <button style={s.ghost} onClick={() => void cancelAppointment(a.id, 'front desk')}>
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
