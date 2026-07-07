/**
 * Landing visibility — default-visible semantics, the single helper's store
 * read, nav filtering, and the notFound() page gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { db } from '@/server/db/store';
import {
  getLandingVisibility,
  isLandingSectionVisible,
  assertLandingVisible,
} from '@/lib/landing-visibility';
import {
  LANDING_SECTIONS,
  sectionForPath,
  isPathVisible,
  filterPublicNavItems,
} from '@/config/landing-sections';
import { publicNavItems } from '@/config/navigation';

// next/navigation notFound() throws a sentinel — mock so we can assert on it.
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

async function seedVisibility(map: Record<string, boolean> | null) {
  await db.update((d) => {
    d.platformSettings = {
      appName: 'Metwork',
      maintenanceMode: false,
      signupsEnabled: true,
      paymentsEnabled: true,
      landingVisibility: map,
      updatedAt: new Date().toISOString(),
    };
  });
}

describe('sectionForPath / isPathVisible (pure)', () => {
  it('maps root and child routes to their section', () => {
    expect(sectionForPath('/programs')).toBe('programs');
    expect(sectionForPath('/programs/some-slug')).toBe('programs');
    expect(sectionForPath('/spaces/abc')).toBe('spaces');
    expect(sectionForPath('/pricing')).toBe('pricing');
  });

  it('never gates home, legal or payment routes', () => {
    for (const href of ['/', '/privacy-policy', '/terms', '/payment/success', '/pay/slug', '/booking/pay/tok', '/consultation/pay/tok', '/login', '/signup']) {
      expect(sectionForPath(href)).toBeNull();
      expect(isPathVisible(href, Object.fromEntries(LANDING_SECTIONS.map((s) => [s, false])))).toBe(true);
    }
  });

  it('missing map or missing key means visible', () => {
    expect(isPathVisible('/programs', {})).toBe(true);
    expect(isPathVisible('/programs', { events: false })).toBe(true);
    expect(isPathVisible('/programs', { programs: false })).toBe(false);
  });
});

describe('filterPublicNavItems (pure)', () => {
  it('is structurally identical to the input when nothing is hidden', () => {
    expect(filterPublicNavItems(publicNavItems, {})).toEqual([...publicNavItems]);
  });

  it('drops hidden links and empty dropdown groups', () => {
    const allHidden = Object.fromEntries(LANDING_SECTIONS.map((s) => [s, false]));
    const filtered = filterPublicNavItems(publicNavItems, allHidden);
    // Every publicNavItems entry maps to a toggleable section → all gone
    expect(filtered).toEqual([]);

    const onlyEventsHidden = filterPublicNavItems(publicNavItems, { events: false });
    const group = onlyEventsHidden.find((i) => i.children);
    expect(group?.children?.some((c) => c.href === '/events')).toBe(false);
    expect(group?.children?.some((c) => c.href === '/programs')).toBe(true);
  });
});

describe('getLandingVisibility (store-backed)', () => {
  it('defaults to {} when settings are absent', async () => {
    expect(await getLandingVisibility()).toEqual({});
  });

  it('returns the stored map', async () => {
    await seedVisibility({ pricing: false });
    expect(await getLandingVisibility()).toEqual({ pricing: false });
    expect(await isLandingSectionVisible('pricing')).toBe(false);
    expect(await isLandingSectionVisible('programs')).toBe(true);
  });

  it('fails open (all visible) when the store read throws', async () => {
    const spy = vi.spyOn(db, 'read').mockRejectedValueOnce(new Error('boom'));
    expect(await getLandingVisibility()).toEqual({});
    spy.mockRestore();
  });
});

describe('assertLandingVisible (page gate)', () => {
  it('passes silently for visible sections', async () => {
    await seedVisibility({ events: false });
    await expect(assertLandingVisible('programs')).resolves.toBeUndefined();
  });

  it('404s hidden sections', async () => {
    await seedVisibility({ events: false });
    await expect(assertLandingVisible('events')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
