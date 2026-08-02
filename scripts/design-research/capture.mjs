/**
 * Design-research capture (spec §12, step 2).
 *
 * Screenshots 15–25 reference sites at both breakpoints salon traffic actually
 * uses — desktop 1440 and mobile 390 — into `out/`, which is gitignored. The
 * output is for internal pattern analysis ONLY: it never ships, is never
 * committed, and is never shown to clients. Nothing from these sites (copy,
 * photography, logos, distinctive layout expression) is reused; only the
 * conventions of the category inform the template.
 *
 * Best-effort per site: a slow or bot-walled site is logged and skipped rather
 * than failing the run. Run: `node scripts/design-research/capture.mjs`.
 */
import { chromium, devices } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDesktop = join(here, 'out', 'desktop');
const outMobile = join(here, 'out', 'mobile');

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function shoot(context, url, path, label) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Let hero media and lazy content settle, then screenshot full-page.
    await page.waitForTimeout(3500);
    await page.screenshot({ path, fullPage: true });
    console.log(`  ok   ${label}`);
    return true;
  } catch (error) {
    console.log(`  skip ${label} — ${String(error).split('\n')[0]}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  const { sites } = JSON.parse(await readFile(join(here, 'sites.json'), 'utf8'));
  await mkdir(outDesktop, { recursive: true });
  await mkdir(outMobile, { recursive: true });

  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mobile = await browser.newContext({ ...devices['iPhone 12'], viewport: { width: 390, height: 844 } });

  let ok = 0;
  for (const site of sites) {
    if (!site.url) continue;
    console.log(`\n${site.name} (${site.bucket})`);
    const name = slug(site.name);
    const d = await shoot(desktop, site.url, join(outDesktop, `${name}.png`), 'desktop');
    const m = await shoot(mobile, site.url, join(outMobile, `${name}.png`), 'mobile');
    if (d || m) ok++;
  }

  await browser.close();
  console.log(`\nCaptured ${ok}/${sites.length} sites into scripts/design-research/out/ (gitignored).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
