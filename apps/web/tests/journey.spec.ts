import { test, expect } from '@playwright/test';

// Imports a small real public Lichess account end to end. Requires
// PENUMBRA_API_KEY set in apps/web/.env.local -- mint one with
// node scripts/seed-dev-api-key.mjs (from the repo root).
test('journey imports a public lichess account', async ({ page }) => {
  await page.goto('/journey');
  await page.fill('input[name="username"]', 'DrNykterstein');
  await page.click('button:has-text("Import")');

  await expect(page.getByText(/Imported \d+ game/i)).toBeVisible({ timeout: 30_000 });
});
