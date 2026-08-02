import { test, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * THE STAGE 4 GATE — the exit criterion for appointments and reach.
 *
 *   A customer books online, receives a WhatsApp confirmation, and the slot is
 *   blocked on the POS.
 *
 * The booking is made against the live availability API (as the Next.js page
 * does); the front desk's POS then pulls it down and it appears on the
 * appointment book — which is what "the slot is blocked on the POS" means. The
 * confirmation is dispatched through the messaging provider (stubbed in
 * development) and shows in the message log as sent.
 */

const API = 'http://localhost:3001';
const SERVICE = 'aaaaaaaa-0000-4000-8000-000000000001';

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

test.describe('Stage 4 gate', () => {
  test('a customer books online, gets a confirmation, and the slot appears on the POS', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const device = await openTerminal(context, '00000000-0000-4000-8000-0000000000c4');
    await login(device);
    await device.evaluate(() => window.__salon.syncNow());

    const beforeCount = await device.evaluate(() => window.__salon.countBookedAppointments());

    // A tomorrow date avoids colliding with slots other gates may have taken.
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const phone = `98${Math.floor(10000000 + Math.random() * 89999999)}`;

    // --- The customer books online, exactly as the Next.js page does --------
    const booking = await device.evaluate(
      async ({ API, SERVICE, date, phone }) => {
        const avail = await fetch(
          `${API}/api/public/acme-salon/availability?serviceId=${SERVICE}&date=${date}`,
        ).then((r) => r.json());
        const slot = avail.slots[0].startAt;
        const res = await fetch(`${API}/api/public/acme-salon/book`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            customerName: 'Online Customer',
            customerPhone: phone,
            serviceId: SERVICE,
            startAt: slot,
          }),
        });
        return { status: res.status, body: await res.json(), slot };
      },
      { API, SERVICE, date, phone },
    );

    expect(booking.status, 'online booking succeeds').toBe(201);
    expect(booking.body.appointmentId, 'a real appointment id comes back').toBeTruthy();

    // --- The slot is no longer offered online (live availability) -----------
    const stillFree = await device.evaluate(
      async ({ API, SERVICE, date, slot }) => {
        const avail = await fetch(
          `${API}/api/public/acme-salon/availability?serviceId=${SERVICE}&date=${date}`,
        ).then((r) => r.json());
        return avail.slots.some((sl: { startAt: string }) => sl.startAt === slot);
      },
      { API, SERVICE, date, slot: booking.slot },
    );
    expect(stillFree, 'the booked slot is no longer offered').toBe(false);

    // --- The confirmation was dispatched ------------------------------------
    const sentConfirm = await device.evaluate(async (API) => {
      const res = await fetch(`${API}/api/messages/recent?template=booking_confirm&status=sent`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
      });
      const body = await res.json();
      return body.messages.length;
    }, API);
    expect(sentConfirm, 'a booking_confirm message went out').toBeGreaterThan(0);

    // --- The slot is blocked on the POS -------------------------------------
    // The front desk's terminal pulls the online booking down onto its book.
    await device.evaluate(() => window.__salon.syncNow());

    await expect
      .poll(
        () => device.evaluate((id) => window.__salon.findAppointment(id), booking.body.appointmentId),
        { timeout: 15_000 },
      )
      .toMatchObject({ source: 'online', status: 'booked' });

    const afterCount = await device.evaluate(() => window.__salon.countBookedAppointments());
    expect(afterCount, 'the appointment now sits on the POS book').toBe(beforeCount + 1);

    await context.close();
  });
});
