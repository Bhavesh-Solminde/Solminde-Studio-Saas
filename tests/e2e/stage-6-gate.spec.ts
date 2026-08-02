import { test, expect, type Page } from '@playwright/test';

/**
 * THE STAGE 6 GATE — the exit criterion for the presentation layer.
 *
 *   An owner changes their dashboard colour, edits their hero, hits publish,
 *   and the public site updates.
 *
 * The whole loop runs through the product: the owner's changes go through the
 * site API (theme is contrast-checked, the hero is a draft), Publish flips the
 * sections live, and the actual Next.js public site — a separate origin — is
 * then loaded and shown to reflect the new hero and accent.
 */

const API = 'http://localhost:3001';
const WEB = 'http://localhost:3000';

async function ownerToken(page: Page): Promise<string> {
  const login = await page.evaluate(async (API) => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: 'acme-salon',
        phone: '9000000001',
        password: 'frontdesk-dev-password',
      }),
    });
    return res.json();
  }, API);
  return login.accessToken;
}

test.describe('Stage 6 gate', () => {
  test('owner changes colour, edits the hero, publishes — and the public site updates', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const admin = await context.newPage();
    await admin.goto('/');
    const token = await ownerToken(admin);

    const headline = `Radiance ${Date.now()}`;
    const accent = '#7c3aed';

    const result = await admin.evaluate(
      async ({ API, token, headline, accent }) => {
        const auth = { 'content-type': 'application/json', Authorization: `Bearer ${token}` };
        // 1. change the accent colour
        const theme = await fetch(`${API}/api/site/settings`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({ theme: { primary: accent } }),
        }).then((r) => r.json());
        // 2. edit the hero (a draft)
        await fetch(`${API}/api/site/sections`, {
          method: 'PUT',
          headers: auth,
          body: JSON.stringify({
            sections: [
              { id: crypto.randomUUID(), type: 'hero', position: 0, enabled: true, data: { headline, cta: 'Book now' } },
              { id: crypto.randomUUID(), type: 'services', position: 1, enabled: true, data: { heading: 'Services' } },
            ],
          }),
        });
        // 3. publish
        const published = await fetch(`${API}/api/site/publish`, { method: 'POST', headers: auth }).then((r) => r.json());
        return { onPrimary: theme.theme.onPrimary, published: published.ok };
      },
      { API, token, headline, accent },
    );

    // Contrast was enforced on save: violet accent takes white text.
    expect(result.onPrimary).toBe('#ffffff');
    expect(result.published).toBe(true);

    // --- The public site reflects the change --------------------------------
    const site = await context.newPage();
    await site.goto(`${WEB}/acme-salon`, { waitUntil: 'networkidle' });

    // The edited hero is live...
    await expect(site.getByRole('heading', { name: headline })).toBeVisible();
    // ...and the new accent drives the Book CTA.
    const cta = site.getByRole('link', { name: 'Book now' }).first();
    await expect(cta).toBeVisible();
    const bg = await cta.evaluate((el) => getComputedStyle(el).backgroundColor);
    // #7c3aed === rgb(124, 58, 237)
    expect(bg).toBe('rgb(124, 58, 237)');

    await context.close();
  });
});
