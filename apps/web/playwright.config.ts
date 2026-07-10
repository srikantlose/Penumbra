import { defineConfig, devices } from '@playwright/test';

// This suite exercises the real apps/api (docs/ROADMAP.md Stage 6) -- it is
// not wired into ci.yml, the same way Stage 4's live Lichess-import
// acceptance gate isn't: it needs docker Postgres/Redis/minio, a running
// analysis worker, fetched engine binaries (~1GB, gitignored), a seeded
// PENUMBRA_API_KEY (scripts/seed-dev-api-key.mjs), and apps/api itself
// running on :3001. Run by hand per the Stage 6 acceptance gate.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
