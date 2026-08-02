import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE STAGE 1 GATE — the exit criterion for the whole project.
 *
 *   Create a customer with WiFi off on Device A. Turn WiFi on. The customer
 *   appears on Device B. Repeat the same op_id twice — no duplicate row.
 *
 * Nothing proceeds to Stage 2 until this passes. Two browser contexts stand in
 * for two terminals: separate IndexedDB, separate outboxes, one server.
 */

const TENANT = {
  tenantSlug: 'acme-salon',
  phone: '9000000001',
  password: 'frontdesk-dev-password',
};

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
      body: JSON.stringify(creds),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    return res.json();
  }, TENANT);

  await page.evaluate((s) => {
    localStorage.setItem('accessToken', s.accessToken);
    localStorage.setItem('localSession', JSON.stringify(s.localSession));
  }, session);

  return session;
}

test.describe('Stage 1 gate', () => {
  test('offline create on A syncs to B, and a replayed op_id creates no duplicate', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    const deviceA = await openTerminal(contextA, '00000000-0000-4000-8000-00000000000a');
    const deviceB = await openTerminal(contextB, '00000000-0000-4000-8000-00000000000b');

    await login(deviceA);
    await login(deviceB);

    const opId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const phone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;

    // --- Device A goes offline -------------------------------------------
    await contextA.setOffline(true);

    // The write must complete with the network down, and it must not wait on
    // it. A local write that awaits the network is the bug this whole
    // architecture exists to prevent.
    const started = Date.now();
    await deviceA.evaluate(
      async ({ opId, customerId, phone }) => {
        await window.__salon.createCustomerOffline({
          opId,
          customer: { id: customerId, name: 'Offline Walk-in', phone },
        });
      },
      { opId, customerId, phone },
    );
    const elapsed = Date.now() - started;

    expect(elapsed, 'local write must not await the network').toBeLessThan(1000);

    const pendingWhileOffline = await deviceA.evaluate(() => window.__salon.pendingOpCount());
    expect(pendingWhileOffline, 'op is queued in the outbox').toBeGreaterThan(0);

    // --- Device A comes back online --------------------------------------
    await contextA.setOffline(false);
    await deviceA.evaluate(() => window.__salon.syncNow());

    await expect
      .poll(() => deviceA.evaluate(() => window.__salon.pendingOpCount()), { timeout: 15_000 })
      .toBe(0);

    // --- The customer appears on Device B --------------------------------
    await deviceB.evaluate(() => window.__salon.syncNow());

    await expect
      .poll(
        () => deviceB.evaluate((id) => window.__salon.findCustomer(id), customerId),
        { timeout: 15_000 },
      )
      .toMatchObject({ phone });

    // --- The same op_id delivered twice ----------------------------------
    const replay = await deviceA.evaluate(
      async ({ opId, customerId, phone }) => window.__salon.replayOp({ opId, customerId, phone }),
      { opId, customerId, phone },
    );

    expect(replay.outcomes[0].status).toBe('acked');
    expect(replay.outcomes[0].duplicate, 'server recognised the replay').toBe(true);

    // The decisive assertion: one row, not two.
    await deviceB.evaluate(() => window.__salon.syncNow());
    const matches = await deviceB.evaluate(
      (p) => window.__salon.countCustomersByPhone(p),
      phone,
    );
    expect(matches, 'replayed op must not create a second customer').toBe(1);

    await contextA.close();
    await contextB.close();
  });
});
