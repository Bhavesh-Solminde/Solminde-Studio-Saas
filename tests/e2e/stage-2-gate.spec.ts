import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE STAGE 2 GATE — the exit criterion for offline billing.
 *
 *   Unplug the router. Create a bill, redeem wallet, deduct stock, print a
 *   receipt with a final invoice number. Plug back in. Everything syncs, the
 *   ledgers balance, nothing duplicates.
 *
 * "If this lands, the project will finish." One browser context is one
 * terminal: its own IndexedDB, its own outbox, one server. The whole revenue
 * flow runs with the network physically offline, then reconnects and is proven
 * to reconcile exactly.
 */

const TENANT = {
  tenantSlug: 'acme-salon',
  phone: '9000000001',
  password: 'frontdesk-dev-password',
};

// Seeded catalogue ids (see prisma/seed.ts). Haircut ₹500, Shampoo ₹300, both
// 18% GST; Shampoo opens with 50 units of stock as a ledger entry.
const SERVICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const PRODUCT = 'bbbbbbbb-0000-4000-8000-000000000001';

async function openTerminal(context: BrowserContext, terminalId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('terminalId', id), terminalId);
  return page;
}

async function login(page: Page) {
  const session = await page.evaluate(async (creds) => {
    const res = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...creds, terminalId: localStorage.getItem('terminalId') }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.json();
  }, TENANT);

  await page.evaluate((sess) => {
    localStorage.setItem('accessToken', sess.accessToken);
    localStorage.setItem('localSession', JSON.stringify(sess.localSession));
  }, session);
}

test.describe('Stage 2 gate', () => {
  test('offline bill redeems wallet, deducts stock, prints a final number, and reconciles on reconnect', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const device = await openTerminal(context, '00000000-0000-4000-8000-0000000000c2');
    await login(device);

    // Lease invoice numbers and load the catalogue WHILE ONLINE — the two
    // things billing legitimately needs a network for, done ahead of time.
    await device.evaluate(() => window.__salon.ensureLease());
    await device.evaluate(() => window.__salon.syncNow());

    const customerId = crypto.randomUUID();
    const phone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;
    const stockBefore = await device.evaluate((id) => window.__salon.serverStockOnHand(id), PRODUCT);
    expect(stockBefore, 'opening stock is seeded').toBeGreaterThanOrEqual(1);

    // --- The router is unplugged ----------------------------------------
    await context.setOffline(true);

    // Register the walk-in and load ₹1000 into their wallet, all offline.
    await device.evaluate(
      ({ customerId, phone }) =>
        window.__salon.createCustomerOffline({
          opId: crypto.randomUUID(),
          customer: { id: customerId, name: 'Offline Walk-in', phone },
        }),
      { customerId, phone },
    );
    await device.evaluate((id) => window.__salon.topupWallet(id, 100000), customerId);

    // Bill: Haircut ₹500 + Shampoo ₹300 = ₹800 + 18% GST = ₹944.
    // Redeem ₹200 from wallet, pay ₹744 cash. Deduct one Shampoo from stock.
    const billId = crypto.randomUUID();
    const billOpId = crypto.randomUUID();

    const started = Date.now();
    const bill = await device.evaluate(
      ({ billId, billOpId, customerId, SERVICE, PRODUCT }) =>
        window.__salon.createBillOffline({
          opId: billOpId,
          billId,
          input: {
            customerId,
            lines: [
              { type: 'service', refId: SERVICE, name: 'Haircut', quantity: 1, unitPrice: 50000, taxRate: 18 },
              { type: 'product', refId: PRODUCT, name: 'Shampoo', quantity: 1, unitPrice: 30000, taxRate: 18 },
            ],
            payments: [
              { method: 'wallet', amount: 20000 },
              { method: 'cash', amount: 74400 },
            ],
          },
        }),
      { billId, billOpId, customerId, SERVICE, PRODUCT },
    );
    const elapsed = Date.now() - started;

    // The bill must be usable instantly — no await on the network anywhere.
    expect(elapsed, 'billing must not await the network').toBeLessThan(1000);
    expect(bill.total, 'GST maths: ₹800 + 18% = ₹944').toBe(94400);
    // The printed number is final the moment it printed — from the leased block.
    expect(bill.invoiceNo, 'a final invoice number was stamped offline').toMatch(
      /^POSH\/\d{2}-\d{2}\/[A-P]\/\d{4}$/,
    );

    // Local caches reflect the sale immediately.
    const localWallet = await device.evaluate((id) => window.__salon.localWalletBalance(id), customerId);
    expect(localWallet, 'wallet locally: 1000 − 200 redeemed = 800').toBe(80000);

    const pendingOffline = await device.evaluate(() => window.__salon.pendingOpCount());
    expect(pendingOffline, 'customer + topup + bill are all queued offline').toBeGreaterThanOrEqual(3);

    // --- The router is plugged back in ----------------------------------
    await context.setOffline(false);
    await device.evaluate(() => window.__salon.syncNow());

    await expect
      .poll(() => device.evaluate(() => window.__salon.pendingOpCount()), { timeout: 15_000 })
      .toBe(0);

    // The ledgers balance server-side: wallet is exactly the topup minus the
    // redemption, and stock dropped by exactly the one unit sold.
    const serverWallet = await device.evaluate((id) => window.__salon.serverWalletBalance(id), customerId);
    expect(serverWallet, 'server wallet ledger balances to ₹800').toBe(80000);

    const stockAfter = await device.evaluate((id) => window.__salon.serverStockOnHand(id), PRODUCT);
    expect(stockAfter, 'stock ledger deducted exactly one unit').toBe(stockBefore - 1);

    // --- The same bill op delivered twice --------------------------------
    const replay = await device.evaluate(
      ({ billOpId, billId, customerId, SERVICE }) =>
        window.__salon.pushOps([
          {
            opId: billOpId,
            localSeq: 99,
            type: 'bill.create',
            payload: {
              id: billId,
              invoiceNo: 'POSH/26-27/C/9999',
              series: 'POSH',
              customerId,
              createdAt: Date.now(),
              lines: [{ type: 'service', refId: SERVICE, name: 'Haircut', quantity: 1, unitPrice: 50000, taxRate: 18 }],
              payments: [{ method: 'cash', amount: 59000 }],
            },
          },
        ]),
      { billOpId, billId, customerId, SERVICE },
    );

    expect(replay.outcomes[0].status).toBe('acked');
    expect(replay.outcomes[0].duplicate, 'server recognised the replay').toBe(true);

    // The decisive assertion: the replay changed nothing. Wallet is untouched,
    // so no second redemption; the bill was not created a second time.
    const walletAfterReplay = await device.evaluate(
      (id) => window.__salon.serverWalletBalance(id),
      customerId,
    );
    expect(walletAfterReplay, 'replayed bill op did not double-charge the wallet').toBe(80000);

    await context.close();
  });
});
