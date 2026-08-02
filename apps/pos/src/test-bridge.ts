import { db, pendingOpCount } from './db';
import { createCustomer, syncNow } from './sync';

/**
 * Test bridge for the Playwright suite.
 *
 * Exposed only when the build is not production, so it cannot ship to a salon.
 * The E2E tests drive the real outbox and sync paths through this rather than
 * reimplementing them, so a passing test proves the actual code works.
 */
export interface SalonTestBridge {
  createCustomerOffline(args: {
    opId: string;
    customer: { id: string; name: string; phone: string };
  }): Promise<string>;
  pendingOpCount(): Promise<number>;
  syncNow(): Promise<void>;
  findCustomer(id: string): Promise<unknown>;
  countCustomersByPhone(phone: string): Promise<number>;
  replayOp(args: { opId: string; customerId: string; phone: string }): Promise<unknown>;
}

declare global {
  interface Window {
    __salon: SalonTestBridge;
  }
}

export function installTestBridge(): void {
  if (import.meta.env.PROD) return;

  window.__salon = {
    createCustomerOffline: ({ opId, customer }) =>
      createCustomer(customer, opId as ReturnType<typeof crypto.randomUUID>),
    pendingOpCount,
    syncNow,
    findCustomer: (id) => db.customers.get(id),
    countCustomersByPhone: (phone) => db.customers.where('phone').equals(phone).count(),

    /** Re-send an already-acked op verbatim, exactly as a retry storm would. */
    async replayOp({ opId, customerId, phone }) {
      const session = JSON.parse(localStorage.getItem('localSession') ?? '{}');
      const res = await fetch(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/api/sync/push`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken') ?? ''}`,
          },
          body: JSON.stringify({
            ops: [
              {
                opId,
                tenantId: session.tenantId,
                terminalId: localStorage.getItem('terminalId'),
                localSeq: 1,
                type: 'customer.create',
                payload: { id: customerId, name: 'Offline Walk-in', phone },
                status: 'pending',
                attempts: 0,
                createdAt: Date.now(),
              },
            ],
          }),
        },
      );
      return res.json();
    },
  };
}
