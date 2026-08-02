import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE STAGE 5 GATE — the exit criterion for reports and ops surfaces.
 *
 *   A new salon can be set up from zero to first bill without a developer
 *   touching the database.
 *
 * The onboarding path is exercised end to end: a service is imported from CSV
 * through the admin API (no SQL, no console), it flows down to the POS
 * catalogue on the next sync, and the front desk rings up the salon's first
 * bill for it — all through the product, exactly as an onboarding session would.
 */

const API = 'http://localhost:3001';

async function openTerminal(context: BrowserContext, terminalId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem('terminalId', id), terminalId);
  return page;
}

async function login(page: Page) {
  const session = await page.evaluate(async (API) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme-salon',
        phone: '9000000001',
        password: 'frontdesk-dev-password',
        terminalId: localStorage.getItem('terminalId'),
      }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.json();
  }, API);
  await page.evaluate((s) => {
    localStorage.setItem('accessToken', s.accessToken);
    localStorage.setItem('localSession', JSON.stringify(s.localSession));
  }, session);
}

test.describe('Stage 5 gate', () => {
  test('a service imported from CSV reaches the POS and can be billed — no database access', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const device = await openTerminal(context, '00000000-0000-4000-8000-0000000000c5');
    await login(device);
    await device.evaluate(() => window.__salon.ensureLease());

    const serviceName = `Onboarded Service ${Date.now()}`;

    // --- Onboarding: import the salon's service menu from a CSV --------------
    const importResult = await device.evaluate(
      async ({ API, serviceName }) => {
        const csv = `name,durationMin,price,taxRate\n${serviceName},45,700,18`;
        const res = await fetch(`${API}/api/admin/import/services`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
          },
          body: JSON.stringify({ csv }),
        });
        return { status: res.status, body: await res.json() };
      },
      { API, serviceName },
    );
    expect(importResult.status).toBe(201);
    expect(importResult.body.imported, 'one service imported from CSV').toBe(1);

    // --- The imported service reaches the POS catalogue on sync -------------
    await device.evaluate(() => window.__salon.syncNow());

    const service = await device.evaluate(
      (name) => window.__salon.findServiceByName(name),
      serviceName,
    );
    expect(service, 'the imported service is in the POS catalogue').toBeTruthy();
    expect((service as { price: number }).price, '₹700 stored as integer paise').toBe(70000);

    // --- The salon's first bill, rung up for that service -------------------
    const svc = service as { id: string; price: number };
    const bill = await device.evaluate(
      ({ svc, serviceName }) =>
        window.__salon.createBillOffline({
          opId: crypto.randomUUID(),
          billId: crypto.randomUUID(),
          input: {
            lines: [
              { type: 'service', refId: svc.id, name: serviceName, quantity: 1, unitPrice: svc.price, taxRate: 18 },
            ],
            payments: [{ method: 'cash', amount: 82600 }],
          },
        }),
      { svc, serviceName },
    );
    // ₹700 + 18% GST = ₹826.
    expect(bill.total, 'first bill totals ₹826 with GST').toBe(82600);

    await device.evaluate(() => window.__salon.syncNow());
    await expect
      .poll(() => device.evaluate(() => window.__salon.pendingOpCount()), { timeout: 15_000 })
      .toBe(0);

    await context.close();
  });
});
