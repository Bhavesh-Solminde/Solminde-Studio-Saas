import { db, getLocalBalance, pendingOpCount } from './db';
import { API, authHeaders, createCustomer, currentSession, getTerminalId, syncNow } from './sync';
import { createBill, ensureLease, topupWallet, voidBill, type CreateBillInput } from './billing';
import { bookAppointment, cancelAppointment, type BookInput } from './appointments';

/**
 * Test bridge for the Playwright suite.
 *
 * Exposed only when the build is not production, so it cannot ship to a salon.
 * The E2E tests drive the real outbox, billing and sync paths through this
 * rather than reimplementing them, so a passing test proves the actual code
 * works.
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

  // --- Stage 2: billing ---
  ensureLease(): Promise<void>;
  topupWallet(customerId: string, amount: number): Promise<void>;
  createBillOffline(args: {
    opId: string;
    billId: string;
    input: CreateBillInput;
  }): Promise<{ billId: string; invoiceNo: string; total: number }>;
  voidBill(billId: string, reason: string): Promise<void>;
  localWalletBalance(customerId: string): Promise<number>;
  localStockOnHand(productId: string): Promise<number>;
  serverWalletBalance(customerId: string): Promise<number>;
  serverStockOnHand(productId: string): Promise<number>;
  findBill(id: string): Promise<unknown>;
  countBillsByInvoice(invoiceNo: string): Promise<number>;
  /** Push arbitrary ops straight to the server — used to replay for idempotency. */
  pushOps(ops: unknown[]): Promise<{ outcomes: { status: string; duplicate?: boolean }[] }>;

  // --- Stage 4: appointments ---
  bookAppointmentOffline(input: BookInput): Promise<string>;
  cancelAppointment(id: string, reason?: string): Promise<void>;
  findAppointment(id: string): Promise<unknown>;
  countBookedAppointments(): Promise<number>;

  // --- Stage 5: onboarding ---
  findServiceByName(name: string): Promise<unknown>;
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
      const res = await fetch(`${API}/api/sync/push`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ops: [
            {
              opId,
              tenantId: session.tenantId,
              terminalId: getTerminalId(),
              localSeq: 1,
              type: 'customer.create',
              payload: { id: customerId, name: 'Offline Walk-in', phone },
              status: 'pending',
              attempts: 0,
              createdAt: Date.now(),
            },
          ],
        }),
      });
      return res.json();
    },

    ensureLease: () => ensureLease(),
    topupWallet: (customerId, amount) => topupWallet(customerId, amount),
    createBillOffline: async ({ opId, billId, input }) => {
      const { billId: id, invoiceNo, total } = await createBill(input, opId, billId);
      return { billId: id, invoiceNo, total };
    },
    voidBill: (billId, reason) => voidBill(billId, reason),
    localWalletBalance: (customerId) => getLocalBalance('wallet', customerId),
    localStockOnHand: (productId) => getLocalBalance('stock', productId),
    async serverWalletBalance(customerId) {
      const res = await fetch(`${API}/api/billing/wallet/${customerId}`, { headers: authHeaders() });
      const body = (await res.json()) as { balance: number };
      return body.balance;
    },
    async serverStockOnHand(productId) {
      const res = await fetch(`${API}/api/billing/stock/${productId}`, { headers: authHeaders() });
      const body = (await res.json()) as { onHand: number };
      return body.onHand;
    },
    findBill: (id) => db.bills.get(id),
    countBillsByInvoice: (invoiceNo) => db.bills.where('invoiceNo').equals(invoiceNo).count(),
    async pushOps(ops) {
      const session = currentSession();
      const stamped = (ops as Record<string, unknown>[]).map((op) => ({
        tenantId: session?.tenantId,
        terminalId: getTerminalId(),
        localSeq: 1,
        status: 'pending',
        attempts: 0,
        createdAt: Date.now(),
        ...op,
      }));
      const res = await fetch(`${API}/api/sync/push`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ ops: stamped }),
      });
      return res.json();
    },

    bookAppointmentOffline: (input) => bookAppointment(input),
    cancelAppointment: (id, reason) => cancelAppointment(id, reason),
    findAppointment: (id) => db.appointments.get(id),
    countBookedAppointments: () => db.appointments.where('status').equals('booked').count(),

    findServiceByName: (name) => db.services.filter((svc) => svc.name === name).first(),
  };
}
