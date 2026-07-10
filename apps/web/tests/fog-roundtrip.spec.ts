import { test, expect } from '@playwright/test';

// Requires a real analysis worker + fetched engines running against the
// same docker Postgres/Redis as apps/api (docs/ROADMAP.md Stage 5's
// acceptance gate) -- a genuine 202->200 round trip, not mocked, so it can
// take a while on the canonical tier.
test('board page fog poll flips 202 -> 200 for a real position', async ({ page }) => {
  test.setTimeout(300_000); // the outer test timeout, not just the assertion below, must cover a real canonical-tier search

  // Distinct from apps/api's own FOG_TEST_FEN fixture and every FEN used
  // elsewhere in this repo -- reusing one would risk a warm cache making
  // this look like a real round trip when it's actually a no-op hit.
  await page.goto('/board');
  await page.fill('input[placeholder="FEN"]', '8/2k5/8/8/8/8/2K5/6B1 w - - 0 1');
  await page.click('button:has-text("Analyze")');

  await expect(page.getByText('CURRENT FOG INDEX')).toBeVisible({ timeout: 300_000 });
});
