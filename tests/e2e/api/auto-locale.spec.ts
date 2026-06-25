/**
 * API-driven e2e: AUTO-LOCALE detection (Prompt 5).
 *
 * Locale negotiation lives entirely in the Edge middleware (next-intl,
 * `localeDetection: true`, `localePrefix: 'always'`), so it is fully assertable
 * at the HTTP layer — no browser needed, fully deterministic and CI-safe:
 *
 *   • First visit to `/` with no NEXT_LOCALE cookie → redirect to the locale
 *     negotiated from `Accept-Language` (fr / ar / en), with an unsupported
 *     language mapping to the app's `defaultLocale` ('en').
 *   • A persisted manual choice (NEXT_LOCALE cookie) OVERRIDES the header — the
 *     same thing that happens after the user clicks the language switcher.
 *   • The localized document is server-rendered with the correct direction:
 *     `dir="rtl"` for ar, `dir="ltr"` for en/fr.
 *
 * A fresh request context per assertion keeps each case's cookie jar clean (the
 * middleware may set NEXT_LOCALE on the detect redirect).
 */
import { test, expect, request as pwRequest } from '@playwright/test';
import { BASE } from './_helpers';

/** First segment of the redirect target for `/`, given an Accept-Language (+ optional cookie). */
async function landingLocale(acceptLanguage: string, cookie?: string): Promise<string> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  try {
    const res = await ctx.get('/', {
      headers: { 'Accept-Language': acceptLanguage, ...(cookie ? { Cookie: cookie } : {}) },
      maxRedirects: 0,
    });
    expect([302, 307, 308], `'/' should redirect (got ${res.status()})`).toContain(res.status());
    const location = res.headers()['location'] ?? '';
    expect(location, 'redirect must carry a Location header').toBeTruthy();
    return new URL(location, BASE).pathname.split('/').filter(Boolean)[0] ?? '';
  } finally {
    await ctx.dispose();
  }
}

/** Server-rendered HTML of a localized landing page. */
async function landingHtml(path: string): Promise<{ status: number; html: string }> {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  try {
    const res = await ctx.get(path);
    return { status: res.status(), html: await res.text() };
  } finally {
    await ctx.dispose();
  }
}

test.describe('Auto-locale detection', () => {
  test('Accept-Language fr → lands on /fr', async () => {
    expect(await landingLocale('fr')).toBe('fr');
    expect(await landingLocale('fr-FR,fr;q=0.9')).toBe('fr');
  });

  test('Accept-Language ar → lands on /ar', async () => {
    expect(await landingLocale('ar')).toBe('ar');
    expect(await landingLocale('ar-DZ,ar;q=0.9,en;q=0.4')).toBe('ar');
  });

  test('Accept-Language en → lands on /en', async () => {
    expect(await landingLocale('en')).toBe('en');
  });

  test('an unsupported language falls back to the default locale (en)', async () => {
    // 'de' is not one of en/fr/ar → next-intl maps it to defaultLocale.
    expect(await landingLocale('de')).toBe('en');
    expect(await landingLocale('zh-CN,zh;q=0.9')).toBe('en');
  });

  test('a persisted NEXT_LOCALE cookie overrides Accept-Language', async () => {
    // Header says en, but the user previously picked ar via the switcher.
    expect(await landingLocale('en', 'NEXT_LOCALE=ar')).toBe('ar');
    // …and the reverse: header ar, cookie fr → fr wins.
    expect(await landingLocale('ar', 'NEXT_LOCALE=fr')).toBe('fr');
  });

  test('the Arabic document is server-rendered RTL; en/fr are LTR', async () => {
    const ar = await landingHtml('/ar');
    expect(ar.status).toBe(200);
    expect(ar.html, '/ar must render dir="rtl"').toContain('dir="rtl"');

    const en = await landingHtml('/en');
    expect(en.status).toBe(200);
    expect(en.html, '/en must render dir="ltr"').toContain('dir="ltr"');

    const fr = await landingHtml('/fr');
    expect(fr.status).toBe(200);
    expect(fr.html, '/fr must render dir="ltr"').toContain('dir="ltr"');
  });
});
