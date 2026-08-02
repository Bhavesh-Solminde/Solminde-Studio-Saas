import Dexie, { type EntityTable } from 'dexie';
import type { OutboxOp } from '@salon/shared';

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
  localBalances: EntityTable<LocalBalance, 'key'>;
  syncMeta: EntityTable<SyncMeta, 'key'>;
};

db.version(1).stores({
  outbox: 'opId, localSeq, status, createdAt',
  customers: 'id, phone, name, updatedAt',
  localBalances: 'key, [ledgerType+ownerId]',
  syncMeta: 'key',
});

export async function pendingOpCount(): Promise<number> {
  return db.outbox.where('status').anyOf('pending', 'sent').count();
}

/** Monotonic per terminal — preserves the order the front desk acted in. */
export async function nextLocalSeq(): Promise<number> {
  const last = await db.outbox.orderBy('localSeq').last();
  return (last?.localSeq ?? 0) + 1;
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
