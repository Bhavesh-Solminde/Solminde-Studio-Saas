import Dexie, { type EntityTable } from 'dexie';
import type { OutboxOp, PaymentMethod } from '@salon/shared';

/**
 * Local database. Every user write lands here first and the UI reads from here
 * only — the billing path must never await the network.
 */

export interface LocalCustomer {
  id: string;
  tenantId: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  tags?: string[];
  updatedAt: number;
  /** True until the server has acked the op that created or changed this row. */
  pending: boolean;
}

/** Catalogue reference data, pulled server-authoritative. Read-only offline. */
export interface LocalService {
  id: string;
  tenantId: string;
  name: string;
  durationMin: number;
  /** Integer paise. */
  price: number;
  taxRate: number;
  updatedAt: number;
}

export interface LocalProduct {
  id: string;
  tenantId: string;
  name: string;
  sku?: string | null;
  /** Integer paise. */
  price: number;
  taxRate: number;
  reorderLevel: number;
  updatedAt: number;
}

export interface LocalBillLine {
  type: 'service' | 'product' | 'package' | 'membership';
  refId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  staffId?: string;
}

export interface LocalPayment {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

/** A bill written locally the instant Save is tapped, printed, then synced. */
export interface LocalBill {
  id: string;
  tenantId: string;
  terminalId: string;
  invoiceNo: string;
  series: string;
  customerId?: string | null;
  lines: LocalBillLine[];
  payments: LocalPayment[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: 'final' | 'void';
  createdAt: number;
  pending: boolean;
}

/**
 * An appointment, in the local cache. Booked on the POS and pushed up, or booked
 * online and pulled DOWN — the latter is how an online booking blocks the slot
 * on the front desk's screen.
 */
export interface LocalAppointment {
  id: string;
  tenantId: string;
  customerId: string;
  staffId?: string | null;
  resourceId?: string | null;
  serviceId: string;
  startAt: number;
  endAt: number;
  status: string;
  source: string;
  notes?: string | null;
  updatedAt: number;
  pending: boolean;
}

/**
 * The terminal's current invoice-number block, leased from the server while
 * online and consumed locally offline. `nextNumber` advances on every bill; the
 * printed number is therefore final the moment it prints, never assigned later.
 */
export interface LocalLease {
  key: string; // `${series}:${financialYear}:${blockStart}` — one row per block
  series: string;
  financialYear: string;
  terminalCode: string;
  blockStart: number;
  blockEnd: number;
  nextNumber: number;
}

/**
 * A pure read cache, rebuildable from the ledger at any time.
 *
 * SUM() over a wallet ledger in Dexie crawls once a regular customer has a few
 * hundred entries, so this is maintained on every ledger write. The server
 * remains the source of truth.
 */
export interface LocalBalance {
  key: string;
  ledgerType: 'wallet' | 'stock' | 'session';
  ownerId: string;
  balance: number;
  updatedAt: number;
}

export interface SyncMeta {
  key: string;
  value: string;
}

export const db = new Dexie('salon-pos') as Dexie & {
  outbox: EntityTable<OutboxOp, 'opId'>;
  customers: EntityTable<LocalCustomer, 'id'>;
  services: EntityTable<LocalService, 'id'>;
  products: EntityTable<LocalProduct, 'id'>;
  bills: EntityTable<LocalBill, 'id'>;
  appointments: EntityTable<LocalAppointment, 'id'>;
  leases: EntityTable<LocalLease, 'key'>;
  localBalances: EntityTable<LocalBalance, 'key'>;
  syncMeta: EntityTable<SyncMeta, 'key'>;
};

db.version(1).stores({
  outbox: 'opId, localSeq, status, createdAt',
  customers: 'id, phone, name, updatedAt',
  localBalances: 'key, [ledgerType+ownerId]',
  syncMeta: 'key',
});

// Stage 2 adds the revenue surface: catalogue, bills and invoice leases.
db.version(2).stores({
  services: 'id, name, updatedAt',
  products: 'id, name, updatedAt',
  bills: 'id, invoiceNo, customerId, status, createdAt',
  leases: 'key',
});

// Stage 4 adds appointments — booked here or pulled down from online bookings.
db.version(3).stores({
  appointments: 'id, startAt, staffId, status, updatedAt',
});

export async function pendingOpCount(): Promise<number> {
  return db.outbox.where('status').anyOf('pending', 'sent').count();
}

/** Monotonic per terminal — preserves the order the front desk acted in. */
export async function nextLocalSeq(): Promise<number> {
  const last = await db.outbox.orderBy('localSeq').last();
  return (last?.localSeq ?? 0) + 1;
}

export function balanceKey(ledgerType: LocalBalance['ledgerType'], ownerId: string): string {
  return `${ledgerType}:${ownerId}`;
}

export async function getLocalBalance(
  ledgerType: LocalBalance['ledgerType'],
  ownerId: string,
): Promise<number> {
  return (await db.localBalances.get(balanceKey(ledgerType, ownerId)))?.balance ?? 0;
}

/**
 * Adjust the cached balance by a signed delta. Pure addition, exactly like the
 * ledger it mirrors — so it commutes and cannot drift from the server's SUM
 * except transiently, and it is rebuildable from the ledger at any time.
 */
export async function adjustLocalBalance(
  ledgerType: LocalBalance['ledgerType'],
  ownerId: string,
  delta: number,
): Promise<void> {
  const key = balanceKey(ledgerType, ownerId);
  await db.transaction('rw', db.localBalances, async () => {
    const current = (await db.localBalances.get(key))?.balance ?? 0;
    await db.localBalances.put({
      key,
      ledgerType,
      ownerId,
      balance: current + delta,
      updatedAt: Date.now(),
    });
  });
}

export async function getCursor(): Promise<string | null> {
  return (await db.syncMeta.get('pullCursor'))?.value ?? null;
}

export async function setCursor(value: string): Promise<void> {
  await db.syncMeta.put({ key: 'pullCursor', value });
}

/**
 * IndexedDB can be evicted under storage pressure, which would destroy
 * unsynced bills. Ask for persistence on first launch.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
