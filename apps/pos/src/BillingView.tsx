import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { computeBill, formatPaise, type BillLineInput } from '@salon/shared';
import { balanceKey, db, type LocalBillLine, type LocalCustomer, type LocalPayment } from './db';
import { createBill, ensureLease, leaseWarning, voidBill } from './billing';
import { printReceipt } from './printer';
import { s } from './styles';

const rupees = (p: number) => `₹${formatPaise(p)}`;

/**
 * Offline billing — the product's revenue surface. Everything here reads and
 * writes local Dexie: selecting a customer, adding lines, redeeming wallet and
 * saving a bill all complete in single-digit milliseconds, and the receipt
 * prints without ever awaiting the network. The only online action is leasing
 * invoice numbers, done ahead of time so the printed number is always final.
 */
export function BillingView() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<LocalBillLine[]>([]);
  const [redeem, setRedeem] = useState(''); // rupees
  const [warning, setWarning] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const services = useLiveQuery(() => db.services.toArray(), [], []);
  const products = useLiveQuery(() => db.products.toArray(), [], []);
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
  const bills = useLiveQuery(() => db.bills.reverse().sortBy('createdAt'), [], []);
  const walletBalance =
    useLiveQuery(
      () => (customerId ? db.localBalances.get(balanceKey('wallet', customerId)) : undefined),
      [customerId],
    )?.balance ?? 0;

  useEffect(() => {
    void ensureLease().then(() => leaseWarning().then(setWarning));
  }, []);

  const computed = useMemo(
    () => (cart.length ? computeBill(cart as BillLineInput[]) : null),
    [cart],
  );
  const total = computed?.total ?? 0;
  const redeemPaise = Math.min(Math.round((Number(redeem) || 0) * 100), walletBalance);
  const cashDue = Math.max(0, total - redeemPaise);

  function addLine(line: Omit<LocalBillLine, 'quantity'>) {
    setCart((prev) => {
      const existing = prev.find((l) => l.refId === line.refId && l.type === line.type);
      if (existing) {
        return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { ...line, quantity: 1 }];
    });
  }

  function setQty(index: number, quantity: number) {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((_, i) => i !== index)
        : prev.map((l, i) => (i === index ? { ...l, quantity } : l)),
    );
  }

  const selectedCustomer = useLiveQuery(
    () => (customerId ? db.customers.get(customerId) : undefined),
    [customerId],
  );

  async function save() {
    if (!computed || cart.length === 0) return;

    const payments: LocalPayment[] = [];
    if (redeemPaise > 0) payments.push({ method: 'wallet', amount: redeemPaise });
    if (cashDue > 0) payments.push({ method: 'cash', amount: cashDue });

    const result = await createBill({
      customerId: customerId ?? undefined,
      lines: cart,
      payments,
    });

    // Print — falls back to an HTML view where Web Serial is unavailable.
    void printReceipt(result.receiptBytes, receiptHtml(cart, computed, result.invoiceNo));
    setLastReceipt(result.invoiceNo);

    // Reset for the next customer.
    setCart([]);
    setRedeem('');
    setCustomerId(null);
    setSearch('');
    void leaseWarning().then(setWarning);
  }

  return (
    <>
      <h1 style={s.title}>Billing</h1>
      {warning && <div style={s.banner}>{warning}</div>}
      {lastReceipt && (
        <div style={{ ...s.banner, background: 'var(--blue-wash)', color: 'var(--signal-blue)' }}>
          Bill {lastReceipt} saved and printing.
        </div>
      )}

      <div style={s.columns}>
        {/* Catalogue */}
        <div style={s.panel}>
          <p style={s.panelTitle}>Services</p>
          {services.map((svc) => (
            <div
              key={svc.id}
              style={s.catalogRow}
              onClick={() =>
                addLine({ type: 'service', refId: svc.id, name: svc.name, unitPrice: svc.price, taxRate: svc.taxRate })
              }
            >
              <span>{svc.name}</span>
              <span style={s.num}>{rupees(svc.price)}</span>
            </div>
          ))}
          <p style={{ ...s.panelTitle, marginTop: 16 }}>Products</p>
          {products.map((prod) => (
            <div
              key={prod.id}
              style={s.catalogRow}
              onClick={() =>
                addLine({ type: 'product', refId: prod.id, name: prod.name, unitPrice: prod.price, taxRate: prod.taxRate })
              }
            >
              <span>{prod.name}</span>
              <span style={s.num}>{rupees(prod.price)}</span>
            </div>
          ))}
          {services.length === 0 && products.length === 0 && (
            <p style={s.empty}>Catalogue syncs from the server. Connect once to load it.</p>
          )}
        </div>

        {/* Cart + payment */}
        <div style={s.panel}>
          <p style={s.panelTitle}>Customer</p>
          <input
            style={{ ...s.input, flex: '1 1 auto', width: '100%', boxSizing: 'border-box' }}
            placeholder={selectedCustomer ? selectedCustomer.name : 'Search phone or name — or leave blank for walk-in'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Customer search"
          />
          {customers.map((c) => (
            <div
              key={c.id}
              style={s.catalogRow}
              onClick={() => {
                setCustomerId(c.id);
                setSearch('');
              }}
            >
              <span>{c.name}</span>
              <span style={s.meta}>{c.phone}</span>
            </div>
          ))}
          {selectedCustomer && (
            <p style={{ ...s.meta, marginTop: 8 }}>
              {selectedCustomer.name} — wallet {rupees(walletBalance)}
            </p>
          )}

          <p style={{ ...s.panelTitle, marginTop: 16 }}>Cart</p>
          {cart.length === 0 && <p style={s.empty}>Tap a service or product to add it.</p>}
          {cart.map((line, i) => (
            <div key={i} style={s.catalogRow}>
              <span>{line.name}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button style={s.ghost} onClick={() => setQty(i, line.quantity - 1)} aria-label="Decrease">
                  −
                </button>
                <span style={{ minWidth: 18, textAlign: 'center' }}>{line.quantity}</span>
                <button style={s.ghost} onClick={() => setQty(i, line.quantity + 1)} aria-label="Increase">
                  +
                </button>
                <span style={{ ...s.num, minWidth: 72 }}>{rupees(line.unitPrice * line.quantity)}</span>
              </span>
            </div>
          ))}

          {computed && (
            <>
              <div style={{ marginTop: 12 }}>
                <div style={s.totalRow}>
                  <span>Subtotal</span>
                  <span style={s.num}>{rupees(computed.subtotal)}</span>
                </div>
                <div style={s.totalRow}>
                  <span>GST</span>
                  <span style={s.num}>{rupees(computed.tax)}</span>
                </div>
                <div style={s.grandTotal}>
                  <span>Total</span>
                  <span style={s.num}>{rupees(computed.total)}</span>
                </div>
              </div>

              {customerId && walletBalance > 0 && (
                <div style={{ marginTop: 12 }}>
                  <label style={s.label} htmlFor="redeem">
                    Redeem from wallet (max {rupees(walletBalance)})
                  </label>
                  <input
                    id="redeem"
                    style={{ ...s.input, flex: '1 1 auto', width: '100%', boxSizing: 'border-box' }}
                    inputMode="decimal"
                    value={redeem}
                    onChange={(e) => setRedeem(e.target.value)}
                  />
                </div>
              )}

              <div style={{ ...s.totalRow, marginTop: 8 }}>
                <span>Cash due</span>
                <span style={s.num}>{rupees(cashDue)}</span>
              </div>

              <button style={{ ...s.primary, width: '100%', marginTop: 12 }} onClick={save}>
                Save &amp; print
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recent bills */}
      <h2 style={{ ...s.title, fontSize: 16, margin: '28px 0 12px' }}>Recent bills</h2>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>Invoice</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Total</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Status</th>
            <th style={{ ...s.th, textAlign: 'right' }}>Sync</th>
            <th style={s.th}></th>
          </tr>
        </thead>
        <tbody>
          {bills.length === 0 && (
            <tr>
              <td colSpan={5} style={s.empty}>
                No bills yet. They save and print with the internet off.
              </td>
            </tr>
          )}
          {bills.map((bill) => (
            <tr key={bill.id}>
              <td style={{ ...s.td, fontVariantNumeric: 'tabular-nums' }}>{bill.invoiceNo}</td>
              <td style={{ ...s.td, ...s.num }}>{rupees(bill.total)}</td>
              <td style={{ ...s.td, textAlign: 'right' }}>
                {bill.status === 'void' ? 'Void' : 'Final'}
              </td>
              <td style={{ ...s.td, textAlign: 'right' }}>
                <span style={bill.pending ? s.waiting : s.settled}>
                  {bill.pending ? 'Pending' : 'Synced'}
                </span>
              </td>
              <td style={{ ...s.td, textAlign: 'right' }}>
                {bill.status !== 'void' && (
                  <button style={s.ghost} onClick={() => void voidBill(bill.id, 'front desk void')}>
                    Void
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Plain-text HTML fallback for printers without Web Serial. */
function receiptHtml(
  lines: LocalBillLine[],
  computed: ReturnType<typeof computeBill>,
  invoiceNo: string,
): string {
  const rows = lines
    .map((l) => `${l.name} x${l.quantity}  ${rupees(l.unitPrice * l.quantity)}`)
    .join('\n');
  return [
    invoiceNo,
    '-------------------------',
    rows,
    '-------------------------',
    `Subtotal  ${rupees(computed.subtotal)}`,
    `GST       ${rupees(computed.tax)}`,
    `TOTAL     ${rupees(computed.total)}`,
  ].join('\n');
}
