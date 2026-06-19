/**
 * UI i18n smoke — the public consultant profile + its inline booking surface
 * render in French and Arabic (RTL) without a layout break.
 *
 * Scope note (decision 2026-06-19): client booking emails / WhatsApp are en/fr
 * only and consultant notifications are French-only by the locked product
 * decision (the consultant portal defaults to French). Arabic notification
 * templates are an intentional known gap (ar → fr fallback), documented in
 * SESSION_LOG.md; this spec therefore asserts the rendered UI in fr + ar and
 * does not assert Arabic email/WhatsApp output.
 *
 * Runs in the `consultation` Playwright project (Desktop Chrome, no auth).
 */
import { test, expect } from '@playwright/test';
import { MENTOR_ID } from './api/_consult-helpers';

const LOCALES = [
  { locale: 'fr', dir: 'ltr' },
  { locale: 'ar', dir: 'rtl' },
] as const;

for (const { locale, dir } of LOCALES) {
  test(`13 — consultant profile + booking surface render in ${locale} (${dir})`, async ({ page }) => {
    const resp = await page.goto(`/${locale}/mentors/${MENTOR_ID}`, { waitUntil: 'networkidle' });
    expect(resp?.status(), `profile page HTTP status (${locale})`).toBeLessThan(400);

    // The seeded mentor renders → not a 404 / notFound.
    await expect(page.getByText('QA Mentor Expert').first()).toBeVisible();

    // Document direction matches the locale (Arabic is fully RTL).
    await expect(page.locator('html')).toHaveAttribute('dir', dir);

    // The inline scheduler + a booking CTA are present for guests.
    await expect(page.getByRole('button').first()).toBeVisible();

    // No horizontal overflow → the RTL/LTR layout did not break the page width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `horizontal overflow in ${locale} (px)`).toBeLessThanOrEqual(1);
  });
}
