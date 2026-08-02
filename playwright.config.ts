import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Sync assertions depend on ordering between two simulated terminals, so
  // these must not run concurrently.
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'pos',
      use: {
        ...devices['Desktop Chrome'],
        // The real target hardware: a 4GB i3 at 1366x768. Testing at 1920
        // hides the density failures that actually matter.
        viewport: { width: 1366, height: 768 },
      },
    },
  ],

  webServer: [
    {
      command: 'pnpm dev:api',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm dev:pos',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
