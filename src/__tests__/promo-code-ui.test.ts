/**
 * The pure pieces behind the promo-code screens: the status every badge shares,
 * the datetime round-trip the edit dialogs rely on, and the nav/i18n wiring that
 * would otherwise only fail at runtime (a missing translation key renders as the
 * raw key; a nav entry without a page is a 404 in the sidebar).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { promoStatus, toLocalInput, toScopedPromoCode, PROMO_CODE_PATTERN } from '@/lib/promo-code-ui';
import { dashboardNavByRole } from '@/config/navigation';
import en from '@/i18n/messages/en.json';
import fr from '@/i18n/messages/fr.json';
import ar from '@/i18n/messages/ar.json';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const base = { isActive: true, expiresAt: null, usageLimit: null, usedCount: 0 };

describe('promoStatus', () => {
  it('is active when nothing stops it', () => {
    expect(promoStatus(base, NOW)).toBe('ACTIVE');
    expect(promoStatus({ ...base, expiresAt: '2027-01-01T00:00:00.000Z', usageLimit: 5, usedCount: 4 }, NOW)).toBe('ACTIVE');
  });
  it('inactive wins over everything else', () => {
    expect(promoStatus({ ...base, isActive: false, expiresAt: '2020-01-01T00:00:00.000Z', usageLimit: 1, usedCount: 1 }, NOW)).toBe('INACTIVE');
  });
  it('expired at, and after, the expiry instant', () => {
    expect(promoStatus({ ...base, expiresAt: '2026-10-06T12:00:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(promoStatus({ ...base, expiresAt: '2026-10-05T00:00:00.000Z' }, NOW)).toBe('EXPIRED');
    expect(promoStatus({ ...base, expiresAt: '2026-10-06T12:00:00.001Z' }, NOW)).toBe('ACTIVE');
  });
  it('limit reached at the limit, never for an unlimited code', () => {
    expect(promoStatus({ ...base, usageLimit: 3, usedCount: 3 }, NOW)).toBe('LIMIT_REACHED');
    expect(promoStatus({ ...base, usageLimit: 3, usedCount: 2 }, NOW)).toBe('ACTIVE');
    expect(promoStatus({ ...base, usageLimit: null, usedCount: 10_000 }, NOW)).toBe('ACTIVE');
  });
});

describe('toLocalInput', () => {
  it('is empty for no date or a bad one', () => {
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput('not a date')).toBe('');
  });
  it('round-trips to the minute in local time', () => {
    const iso = '2026-12-31T10:45:30.123Z';
    const local = toLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // Re-reading the local string gives the same instant, to the minute.
    expect(Math.floor(new Date(local).getTime() / 60_000)).toBe(Math.floor(Date.parse(iso) / 60_000));
  });
});

describe('toScopedPromoCode', () => {
  it('keeps what the screens need and drops the legacy mirrored fields and the owner id', () => {
    const dto = toScopedPromoCode({
      id: 'x', code: 'A1B', discountPercent: 10, usedCount: 2, usageLimit: 5, expiresAt: null, isActive: true,
      scope: { programIds: ['p'], spaceIds: [] },
      // @ts-expect-error — extra stored fields must not leak into the DTO
      ownerIncubatorId: 'inc', maxUses: 5, useCount: 2, discountValue: 10,
    });
    expect(Object.keys(dto).sort()).toEqual(['code', 'discountPercent', 'expiresAt', 'id', 'isActive', 'scope', 'usageLimit', 'usedCount']);
  });
  it('defaults the optional fields so the UI never sees undefined', () => {
    // @ts-expect-error — a legacy record lacking the optional fields
    const dto = toScopedPromoCode({ id: 'x', code: 'A1B', discountPercent: 10, isActive: true });
    expect(dto).toMatchObject({ usedCount: 0, usageLimit: null, expiresAt: null, scope: null });
  });
});

describe('PROMO_CODE_PATTERN', () => {
  it('matches the API rule', () => {
    for (const ok of ['ABC', 'ramadan20', 'A_B-C9', 'x'.repeat(32)]) expect(PROMO_CODE_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ['ab', 'a b', 'x'.repeat(33), '<b>', 'é1é', '']) expect(PROMO_CODE_PATTERN.test(bad), bad).toBe(false);
  });
});

describe('incubator navigation and translations', () => {
  const entry = dashboardNavByRole.INCUBATOR.find((i) => i.href === '/dashboard/incubator/promo-codes');

  it('has a sidebar entry that points at a real page', () => {
    expect(entry).toBeTruthy();
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/[locale]/dashboard/incubator/promo-codes/page.tsx'))).toBe(true);
  });

  it('sits right after Programs', () => {
    const hrefs = dashboardNavByRole.INCUBATOR.map((i) => i.href);
    expect(hrefs.indexOf('/dashboard/incubator/promo-codes')).toBe(hrefs.indexOf('/dashboard/incubator/programs') + 1);
  });

  it.each([['en', en], ['fr', fr], ['ar', ar]] as const)('%s has every key the screens use, and keeps ICU placeholders aligned', (_l, m) => {
    const msgs = m as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(msgs.dashboard.promoCodes).toBeTruthy();
    expect(msgs.pages.dashboard.incubator.promoCodes.title).toBeTruthy();
    expect(msgs.registrationDashboard.tabPromo).toBeTruthy();
    const ns = msgs.incubator.promoCodes as Record<string, string>;
    const enNs = (en as unknown as Record<string, any>).incubator.promoCodes as Record<string, string>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(Object.keys(ns).sort()).toEqual(Object.keys(enNs).sort());
    const vars = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((x) => x[1]).sort();
    for (const k of Object.keys(enNs)) expect(vars(ns[k]!), `${_l}.${k}`).toEqual(vars(enNs[k]!));
  });
});
