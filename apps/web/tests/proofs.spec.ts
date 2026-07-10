import { test, expect } from '@playwright/test';

test('proofs page shows at least one real published certificate', async ({ page }) => {
  await page.goto('/proofs');
  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(0);
});
