import {
  computeBill,
  formatInvoiceNo,
  renderReceipt,
  walletEffectsForBill,
  LEASE_BLOCK_SIZE,
  RELEASE_AT_FRACTION,
  type BillLineInput,
  type PaymentInput,
  type Receipt,
} from '@salon/shared';
import {
  adjustLocalBalance,
  db,
  type LocalBill,
  type LocalBillLine,
  type LocalLease,
  type LocalPayment,
} from './db';
import { API, authHeaders, currentSession, enqueue, getTerminalId } from './sync';

const DEFAULT_SERIES = 'POSH';
/** Warn the front desk once a block is down to this many numbers. */
const LOW_BLOCK_WARNING = 30;

// ------------------------------------------------------- invoice leasing

/**
 * The number printed on a receipt must be final the instant it prints. That is
 * only possible if the terminal already holds a block of numbers it can consume
 * without asking the server — which is what leasing provides. Leasing itself is
 * the one billing action that legitimately needs the network, so it is done
 * proactively while online and never on the critical Save path.
 */
export async function fetchLease(
  series = DEFAULT_SERIES,
  terminalCode = terminalCodeFor(getTerminalId()),
): Promise<LocalLease> {
  const res = await fetch(`${API}/api/billing/lease`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ terminalId: getTerminalId(), series, terminalCode }),
  });
  if (!res.ok) throw new Error(`Could not lease invoice numbers: ${res.status}`);
  const grant = (await res.json()) as {
    series: string;
    financialYear: string;
    terminalCode: string;
    blockStart: number;
    blockEnd: number;
    nextNumber: number;
  };

  const lease: LocalLease = {
    key: `${grant.series}:${grant.financialYear}:${grant.blockStart}`,
    series: grant.series,
    financialYear: grant.financialYear,
    terminalCode: grant.terminalCode,
    blockStart: grant.blockStart,
    blockEnd: grant.blockEnd,
    nextNumber: grant.nextNumber,
  };
  await db.leases.put(lease);
  return lease;
}

/** The lowest-numbered block for a series that still has numbers left. */
export async function activeLease(series = DEFAULT_SERIES): Promise<LocalLease | undefined> {
  const leases = await db.leases.toArray();
  return leases
    .filter((l) => l.series === series && l.nextNumber <= l.blockEnd)
    .sort((a, b) => a.blockStart - b.blockStart)[0];
}

/** Numbers remaining across every block held for a series. */
export async function remainingNumbers(series = DEFAULT_SERIES): Promise<number> {
  const leases = await db.leases.toArray();
  return leases
    .filter((l) => l.series === series)
    .reduce((sum, l) => sum + Math.max(0, l.blockEnd - l.nextNumber + 1), 0);
}

/**
 * Ensure a block is available, leasing one if online and none is held. Call
 * this on login and on reconnect, not on the Save path.
 *
 * Never throws: before login there is no token to lease with, and a transient
 * lease failure must not crash the billing screen — the low-block warning is
 * what tells the front desk to reconnect, not an exception.
 */
export async function ensureLease(series = DEFAULT_SERIES): Promise<void> {
  if (!currentSession() || !navigator.onLine) return;
  const active = await activeLease(series);
  if (active) return;
  try {
    await fetchLease(series);
  } catch {
    // Leave it unleased; consumeInvoiceNumber and leaseWarning both surface it.
  }
}

/**
 * Consume the next invoice number for a series — a pure local read of the
 * leased block, no network. When the block crosses the re-lease threshold it
 * fires a background lease of the next block so the terminal never runs dry
 * mid-shift; that fetch is fire-and-forget and never blocks this return.
 */
export async function consumeInvoiceNumber(series = DEFAULT_SERIES): Promise<string> {
  const lease = await activeLease(series);
  if (!lease) {
    throw new Error(
      'No invoice numbers leased. Connect to the internet once to lease a block before billing.',
    );
  }

  const n = lease.nextNumber;
  const invoiceNo = formatInvoiceNo(lease.series, lease.financialYear, lease.terminalCode, n);
  await db.leases.update(lease.key, { nextNumber: n + 1 });

  const consumed = n - lease.blockStart + 1;
  if (consumed >= LEASE_BLOCK_SIZE * RELEASE_AT_FRACTION && navigator.onLine) {
    // Only lease a fresh block if we don't already hold one beyond this.
    void remainingNumbers(series).then((left) => {
      if (left <= LEASE_BLOCK_SIZE * (1 - RELEASE_AT_FRACTION)) void fetchLease(series);
    });
  }

  return invoiceNo;
}

/** A short, stable per-terminal code for the printed number (…/A/0001). */
function terminalCodeFor(terminalId: string): string {
  // Last hex nibble mapped to A–P. Good enough to disambiguate the handful of
  // terminals one salon runs; the server guarantees ranges never overlap anyway.
  const nibble = parseInt(terminalId.replace(/[^0-9a-f]/gi, '').slice(-1) || '0', 16);
  return String.fromCharCode(65 + (nibble % 16));
}

// ------------------------------------------------------------- billing

export interface CreateBillInput {
  customerId?: string;
  lines: LocalBillLine[];
  payments: LocalPayment[];
  series?: string;
}

export interface CreatedBill {
  billId: string;
  invoiceNo: string;
  total: number;
  receiptBytes: Uint8Array;
}

/**
 * Create a bill entirely locally, then print. The order is load-bearing:
 * outbox op first, then the bill row, then the balance caches — a crash between
 * any two leaves a queued op the server will still process, never a local
 * change it never hears about. There is no network await on this path; the
 * receipt is ready in single-digit milliseconds.
 */
export async function createBill(
  input: CreateBillInput,
  opId: string = crypto.randomUUID(),
  billId: string = crypto.randomUUID(),
): Promise<CreatedBill> {
  const session = currentSession();
  if (!session) throw new Error('No local session');

  const series = input.series ?? DEFAULT_SERIES;
  const computed = computeBill(input.lines as BillLineInput[]);
  const invoiceNo = await consumeInvoiceNumber(series);
  const createdAt = Date.now();

  const payload = {
    id: billId,
    invoiceNo,
    series,
    customerId: input.customerId ?? null,
    createdAt,
    lines: input.lines,
    payments: input.payments,
  };

  // 1. Outbox first — same enqueue path every other op uses, so ordering,
  //    localSeq and the background drain trigger stay in one place.
  await enqueue('bill.create', payload, opId);

  // 2. The local bill row.
  const bill: LocalBill = {
    id: billId,
    tenantId: session.tenantId,
    terminalId: getTerminalId(),
    invoiceNo,
    series,
    customerId: input.customerId ?? null,
    lines: input.lines,
    payments: input.payments,
    subtotal: computed.subtotal,
    discount: computed.discount,
    tax: computed.tax,
    total: computed.total,
    status: 'final',
    createdAt,
    pending: true,
  };
  await db.bills.add(bill);

  // 3. Balance caches — pure addition, mirroring the server ledgers.
  for (const line of input.lines) {
    if (line.type === 'product' && line.refId) {
      await adjustLocalBalance('stock', line.refId, -line.quantity);
    }
  }
  if (input.customerId) {
    for (const effect of walletEffectsForBill(computed.total, input.payments as PaymentInput[])) {
      await adjustLocalBalance('wallet', input.customerId, effect.delta);
    }
  }

  return {
    billId,
    invoiceNo,
    total: computed.total,
    receiptBytes: renderReceipt(buildReceipt(bill)),
  };
}

/** Load a prepaid advance into a customer's wallet. Offline-first. */
export async function topupWallet(customerId: string, amount: number): Promise<void> {
  await enqueue('wallet.topup', { customerId, amount });
  await adjustLocalBalance('wallet', customerId, amount);
}

/**
 * Void a bill: a reversing action, not a delete. The local caches are wound
 * back by the mirror of what the sale applied, exactly as the server will do
 * with reversing ledger entries when the void op syncs.
 */
export async function voidBill(billId: string, reason: string): Promise<void> {
  const bill = await db.bills.get(billId);
  if (!bill) throw new Error(`Bill not found locally: ${billId}`);
  if (bill.status === 'void') return;

  await enqueue('bill.void', { billId, reason });
  await db.bills.update(billId, { status: 'void' });

  for (const line of bill.lines) {
    if (line.type === 'product' && line.refId) {
      await adjustLocalBalance('stock', line.refId, line.quantity);
    }
  }
  if (bill.customerId) {
    for (const effect of walletEffectsForBill(bill.total, bill.payments as PaymentInput[])) {
      await adjustLocalBalance('wallet', bill.customerId, -effect.delta);
    }
  }
}

/**
 * Close the day for this terminal: reconcile counted cash against the day's
 * cash takings. Expected cash is computed locally from final bills, and the
 * server recomputes it authoritatively when the op syncs.
 */
export async function dayClose(
  businessDate: string,
  countedCash: number,
): Promise<{ expectedCash: number; variance: number }> {
  const dayStart = new Date(`${businessDate}T00:00:00`).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const bills = await db.bills
    .where('createdAt')
    .between(dayStart, dayEnd)
    .filter((b) => b.status === 'final')
    .toArray();

  const expectedCash = bills
    .flatMap((b) => b.payments)
    .filter((p) => p.method === 'cash')
    .reduce((sum, p) => sum + p.amount, 0);

  await enqueue('day.close', { id: crypto.randomUUID(), businessDate, countedCash });
  return { expectedCash, variance: countedCash - expectedCash };
}

/** Low-block warning for the UI: how urgent a re-lease is. */
export async function leaseWarning(series = DEFAULT_SERIES): Promise<string | null> {
  const left = await remainingNumbers(series);
  if (left === 0) return 'No invoice numbers left — connect to lease a new block.';
  if (left <= LOW_BLOCK_WARNING) return `${left} invoice numbers left in this block.`;
  return null;
}

// -------------------------------------------------------------- receipt

function buildReceipt(bill: LocalBill): Receipt {
  // Reuse the one canonical bill calculation for the tax-inclusive line totals,
  // rather than a second rounding path that could drift from the printed total.
  const computed = computeBill(bill.lines as BillLineInput[]);
  return {
    salonName: localStorage.getItem('salonName') ?? 'Salon',
    invoiceNo: bill.invoiceNo,
    dateStr: new Date(bill.createdAt).toLocaleString('en-IN'),
    lines: computed.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      amount: line.lineTotal,
    })),
    subtotal: bill.subtotal,
    discount: bill.discount,
    tax: bill.tax,
    total: bill.total,
    payments: bill.payments.map((p) => ({ method: p.method, amount: p.amount })),
  };
}
