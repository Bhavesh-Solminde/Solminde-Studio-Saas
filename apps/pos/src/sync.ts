import { backoffMs, type OutboxOp } from '@salon/shared';
import { db, getCursor, nextLocalSeq, setCursor, type LocalCustomer } from './db';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const BATCH_SIZE = 50;

function session() {
  const raw = localStorage.getItem('localSession');
  return raw ? (JSON.parse(raw) as { tenantId: string; userId: string }) : null;
}

function authHeaders(): HeadersInit {
  return {
    'content-type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
  };
}

/**
 * Enqueue an operation and apply it locally.
 *
 * Order matters: the op goes into the outbox BEFORE local state changes, so a
 * crash between the two leaves a queued op rather than a local change the
 * server will never hear about.
 *
 * Note there is no `await` on any network call in this function. That is the
 * point — perceived latency is a Dexie write, not a round trip.
 */
export async function enqueue<T>(type: string, payload: T): Promise<string> {
  const current = session();
  if (!current) throw new Error('No local session');

  const op: OutboxOp = {
    opId: crypto.randomUUID(),
    tenantId: current.tenantId,
    terminalId: localStorage.getItem('terminalId') ?? crypto.randomUUID(),
    localSeq: await nextLocalSeq(),
    type,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
  };

  await db.outbox.add(op);

  // Fire-and-forget. Never awaited on a user-facing path.
  if (navigator.onLine) void drain();

  return op.opId;
}

/**
 * Create a customer. Optimistic: the row is usable the instant this returns.
 *
 * `opId` is normally generated here; tests pass one in so they can replay a
 * specific operation and prove the server dedupes it.
 */
export async function createCustomer(
  customer: Omit<LocalCustomer, 'tenantId' | 'updatedAt' | 'pending'>,
  opId = crypto.randomUUID(),
): Promise<string> {
  const current = session();
  if (!current) throw new Error('No local session');

  // Outbox first, then local state — a crash between the two leaves a queued
  // op rather than a local change the server will never hear about.
  await db.outbox.add({
    opId,
    tenantId: current.tenantId,
    terminalId: localStorage.getItem('terminalId') ?? crypto.randomUUID(),
    localSeq: await nextLocalSeq(),
    type: 'customer.create',
    payload: customer,
    status: 'pending',
    attempts: 0,
    createdAt: Date.now(),
  });

  await db.customers.put({
    ...customer,
    tenantId: current.tenantId,
    updatedAt: Date.now(),
    pending: true,
  });

  if (navigator.onLine) void drain();
  return opId;
}

let draining = false;

/** Drain the outbox in localSeq order. Batched at 50 ops. */
export async function drain(): Promise<void> {
  if (draining || !navigator.onLine) return;
  draining = true;

  try {
    for (;;) {
      const batch = await db.outbox
        .where('status')
        .anyOf('pending', 'sent')
        .sortBy('localSeq')
        .then((ops) => ops.slice(0, BATCH_SIZE));

      if (batch.length === 0) return;

      const res = await fetch(`${API}/api/sync/push`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ops: batch }),
      });

      if (!res.ok) {
        // Back off and leave the ops queued. Never discard them — losing an
        // unsynced bill is the failure mode this system exists to prevent.
        for (const op of batch) {
          await db.outbox.update(op.opId, { attempts: op.attempts + 1 });
        }
        const worst = Math.max(...batch.map((op) => op.attempts));
        setTimeout(() => void drain(), backoffMs(worst));
        return;
      }

      const { outcomes } = (await res.json()) as {
        outcomes: { opId: string; status: 'acked' | 'rejected' }[];
      };

      for (const outcome of outcomes) {
        if (outcome.status === 'acked') {
          await db.outbox.delete(outcome.opId);
          const op = batch.find((candidate) => candidate.opId === outcome.opId);
          const payload = op?.payload as { id?: string } | undefined;
          if (op?.type === 'customer.create' && payload?.id) {
            await db.customers.update(payload.id, { pending: false });
          }
        } else {
          // Rejected ops are marked, not deleted. The server has already
          // recorded a sync exception for the owner to resolve.
          await db.outbox.update(outcome.opId, { status: 'rejected' });
        }
      }
    }
  } finally {
    draining = false;
  }
}

/** Cursor pull. Reference data is server-authoritative; last-write-wins is correct. */
export async function pull(): Promise<void> {
  if (!navigator.onLine) return;

  const since = await getCursor();
  const url = new URL(`${API}/api/sync/pull`);
  url.searchParams.set('tables', 'customers');
  if (since) url.searchParams.set('since', since);

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return;

  const body = (await res.json()) as {
    changes: { customers?: LocalCustomer[] };
    tombstones: { tableName: string; rowId: string }[];
    cursor: string;
  };

  for (const customer of body.changes.customers ?? []) {
    const existing = await db.customers.get(customer.id);
    // Never clobber a row that still has unsynced local changes.
    if (existing?.pending) continue;
    await db.customers.put({
      ...customer,
      updatedAt: new Date(customer.updatedAt).getTime(),
      pending: false,
    });
  }

  for (const tombstone of body.tombstones) {
    if (tombstone.tableName === 'customers') await db.customers.delete(tombstone.rowId);
  }

  await setCursor(body.cursor);
}

export async function syncNow(): Promise<void> {
  await drain();
  await pull();
}

/**
 * Trigger on: online, focus, every 60s while online, and immediately after any
 * outbox write. Never blocks the UI.
 */
export function startSyncWorker(): () => void {
  const tick = () => void syncNow();

  window.addEventListener('online', tick);
  window.addEventListener('focus', tick);
  const interval = window.setInterval(() => {
    if (navigator.onLine) tick();
  }, 60_000);

  tick();

  return () => {
    window.removeEventListener('online', tick);
    window.removeEventListener('focus', tick);
    window.clearInterval(interval);
  };
}
