import { test, expect } from '@playwright/test';

const ROUTES = ['/', '/board', '/positions', '/frontier', '/proofs', '/methodology', '/journey'];

for (const route of ROUTES) {
  test(`${route} renders with a live WebGL background and no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto(route);
    expect(response?.ok()).toBe(true);

    // Every route mounts the persistent WebGL shader background as the
    // first canvas in the DOM (root layout) -- some routes (e.g. /frontier)
    // add their own decorative canvas on top, so .first() specifically.
    const hasWebGL = await page.locator('canvas').first().evaluate((canvas: HTMLCanvasElement) => {
      const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
      return gl !== null;
    });
    expect(hasWebGL).toBe(true);

    expect(errors, `console errors on ${route}:\n${errors.join('\n')}`).toEqual([]);
  });
}
