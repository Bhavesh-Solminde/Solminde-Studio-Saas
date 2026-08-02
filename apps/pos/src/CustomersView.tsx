import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { createCustomer } from './sync';
import { s } from './styles';

/**
 * Customers end-to-end — the Stage 1 surface. Every read and write here touches
 * only Dexie, so there is no spinner and no await on the network anywhere.
 */
export function CustomersView() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const customers = useLiveQuery(() => db.customers.reverse().sortBy('updatedAt'), [], []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !phone.trim()) return;
    await createCustomer({ id: crypto.randomUUID(), name: name.trim(), phone: phone.trim() });
    setName('');
    setPhone('');
  }

  return (
    <>
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
    </>
  );
}
