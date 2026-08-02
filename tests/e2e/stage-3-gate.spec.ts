import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE STAGE 3 GATE — the exit criterion for commissions.
 *
 *   Two stylists on different commission structures bill the same service and
 *   each sees only their own correct number.
 *
 * The bills are created OFFLINE and carry the stylist on each line, so this also
 * proves the offline path threads staff attribution all the way through to the
 * commission the server computes on sync. `view_own` is enforced server-side:
 * a stylist logging in sees exactly one row — their own — and nobody else's
 * earnings, which is the split that prevents salon-floor fights.
 */

const API = 'http://localhost:3001';
const SERVICE = 'aaaaaaaa-0000-4000-8000-000000000001';
const STAFF_A = 'dddddddd-0000-4000-8000-000000000001'; // 30% service rule
const STAFF_B = 'dddddddd-0000-4000-8000-000000000002'; // 40% service rule

async function openTerminal(context: BrowserContext, terminalId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('terminalId', id), terminalId);
  return page;
}

async function login(page: Page, phone: string, password: string) {
  const session = await page.evaluate(
    async ({ phone, password, API }) => {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: 'acme-salon',
          phone,
          password,
          terminalId: localStorage.getItem('terminalId'),
        }),
      });
      if (!res.ok) throw new Error(`Login failed: ${res.status}`);
      return res.json();
    },
    { phone, password, API },
  );
  await page.evaluate((s) => {
    localStorage.setItem('accessToken', s.accessToken);
    localStorage.setItem('localSession', JSON.stringify(s.localSession));
  }, session);
  return session;
}

/** Fetch a commission summary with whatever token is currently in localStorage. */
async function summary(page: Page, from: string, to: string) {
  return page.evaluate(
    async ({ from, to, API }) => {
      const res = await fetch(
        `${API}/api/commissions/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } },
      );
      return res.json();
    },
    { from, to, API },
  );
}

test.describe('Stage 3 gate', () => {
  test('two stylists bill the same service offline; each sees only their own correct commission', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const device = await openTerminal(context, '00000000-0000-4000-8000-0000000000c3');

    // Owner logs in, leases numbers and loads the catalogue while online.
    await login(device, '9000000001', 'frontdesk-dev-password');
    await device.evaluate(() => window.__salon.ensureLease());
    await device.evaluate(() => window.__salon.syncNow());

    const from = new Date(Date.now() - 60_000).toISOString();

    // --- Offline: bill the same ₹500 haircut under each stylist ----------
    await context.setOffline(true);

    await device.evaluate(
      ({ SERVICE, STAFF_A }) =>
        window.__salon.createBillOffline({
          opId: crypto.randomUUID(),
          billId: crypto.randomUUID(),
          input: {
            lines: [
              { type: 'service', refId: SERVICE, name: 'Haircut', quantity: 1, unitPrice: 50000, taxRate: 18, staffId: STAFF_A },
            ],
            payments: [{ method: 'cash', amount: 59000 }],
          },
        }),
      { SERVICE, STAFF_A },
    );

    await device.evaluate(
      ({ SERVICE, STAFF_B }) =>
        window.__salon.createBillOffline({
          opId: crypto.randomUUID(),
          billId: crypto.randomUUID(),
          input: {
            lines: [
              { type: 'service', refId: SERVICE, name: 'Haircut', quantity: 1, unitPrice: 50000, taxRate: 18, staffId: STAFF_B },
            ],
            payments: [{ method: 'cash', amount: 59000 }],
          },
        }),
      { SERVICE, STAFF_B },
    );

    // --- Reconnect and drain --------------------------------------------
    await context.setOffline(false);
    await device.evaluate(() => window.__salon.syncNow());
    await expect
      .poll(() => device.evaluate(() => window.__salon.pendingOpCount()), { timeout: 15_000 })
      .toBe(0);

    const to = new Date(Date.now() + 60_000).toISOString();

    // --- Owner sees both, each correct and separate ----------------------
    const all = await summary(device, from, to);
    expect(all.scope).toBe('all');
    const rowA = all.rows.find((r: { staffId: string }) => r.staffId === STAFF_A);
    const rowB = all.rows.find((r: { staffId: string }) => r.staffId === STAFF_B);
    // 30% of ₹500 = ₹150; 40% of ₹500 = ₹200. Same service, different numbers.
    expect(rowA.total, 'stylist A earns 30% = ₹150').toBe(15000);
    expect(rowB.total, 'stylist B earns 40% = ₹200').toBe(20000);

    // --- Stylist A logs in and sees ONLY their own number ----------------
    await login(device, '9000000010', 'stylist-dev-password');
    const own = await summary(device, from, to);
    expect(own.scope, 'view_own scopes the summary').toBe('own');
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0].staffId).toBe(STAFF_A);
    expect(own.rows[0].total, 'stylist A sees their own ₹150').toBe(15000);
    // The decisive assertion: stylist B's earnings are nowhere in the response.
    expect(
      own.rows.some((r: { staffId: string }) => r.staffId === STAFF_B),
      "another stylist's number must not be visible",
    ).toBe(false);

    await context.close();
  });
});
