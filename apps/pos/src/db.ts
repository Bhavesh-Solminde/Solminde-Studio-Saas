import Dexie, { type EntityTable } from 'dexie';
import type { OutboxOp } from '@salon/shared';

/**
 * Local database. Every user write lands here first and the UI reads from here
 * only — the billing path must never await the network.
 *
 * `localBalances` is a pure read cache rebuildable from the ledger at any time.
 * SUM() over a wallet ledger in Dexie crawls once a regular customer has a few
 * hundred entries, so the cache is updated on every ledger write. The server
 * remains the source of truth.
 */
export interface LocalBalance {
  key: string;
  ledgerType: 'wallet' | 'stock' | 'session';
  ownerId: string;
  balance: number;
  updatedAt: number;
}

export const db = new Dexie('salon-pos') as Dexie & {
  outbox: EntityTable<OutboxOp, 'opId'>;
  localBalances: EntityTable<LocalBalance, 'key'>;
};

db.version(1).stores({
  outbox: 'opId, localSeq, status, createdAt',
  localBalances: 'key, [ledgerType+ownerId]',
});

export async function pendingOpCount(): Promise<number> {
  return db.outbox.where('status').anyOf('pending', 'sent').count();
}

/**
 * IndexedDB can be evicted under storage pressure, which would destroy unsynced
 * bills. Ask for persistence on first launch.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
