/**
 * City code ⇄ label resolution.
 *
 * The wilaya picker stores a stable CODE ('algiers'), but plenty of stored
 * values predate the picker and hold free text the user typed ('Alger'). Both
 * must keep working everywhere a city is shown — and, critically, a raw code
 * must never reach a human-facing surface: the public consultant profile or,
 * worst of all, the French contract, which would otherwise read
 * "Fait à algiers".
 */
import { describe, it, expect } from 'vitest';
import { algerianCities, findCityCode, formatCityLabel, getCityName } from '@/config/cities';

describe('findCityCode', () => {
  it('accepts the canonical code', () => {
    expect(findCityCode('algiers')).toBe('algiers');
  });

  it('accepts a display name in any locale', () => {
    expect(findCityCode('Alger')).toBe('algiers');    // fr
    expect(findCityCode('Algiers')).toBe('algiers');  // en
    expect(findCityCode('الجزائر')).toBe('algiers');  // ar
  });

  it('is case- and accent-insensitive', () => {
    expect(findCityCode('SETIF')).toBe('setif');
    expect(findCityCode('Sétif')).toBe('setif');
    expect(findCityCode('  béjaïa ')).toBe('bejaia');
  });

  it('returns null only for a genuine non-wilaya', () => {
    expect(findCityCode('Atlantis')).toBeNull();
    expect(findCityCode('')).toBeNull();
    expect(findCityCode(null)).toBeNull();
  });

  it('resolves names with apostrophes, spaces and hyphens however they are typed', () => {
    // The shapes legacy free text actually comes in.
    for (const v of ["M'Sila", 'M’Sila', 'Msila', 'msila', 'M SILA']) {
      expect(findCityCode(v)).toBe('msila');
    }
    for (const v of ['El Oued', 'el-oued', 'ElOued']) {
      expect(findCityCode(v)).toBe('eloued');
    }
    for (const v of ['Bordj Bou Arréridj', 'bordj bou arreridj', 'BordjBouArreridj']) {
      expect(findCityCode(v)).toBe('bordjbouarreridj');
    }
  });
});

describe('formatCityLabel', () => {
  it('turns a stored code into the localized wilaya name', () => {
    expect(formatCityLabel('algiers', 'fr')).toBe('Alger');
    expect(formatCityLabel('algiers', 'en')).toBe('Algiers');
    expect(formatCityLabel('algiers', 'ar')).toBe('الجزائر');
  });

  it('normalizes a legacy free-text name to the localized one', () => {
    expect(formatCityLabel('Alger', 'en')).toBe('Algiers');
    expect(formatCityLabel('Algiers', 'fr')).toBe('Alger');
  });

  it('passes unknown free text through unchanged rather than blanking it', () => {
    // Showing what the consultant actually typed beats showing nothing.
    expect(formatCityLabel('Bouira', 'fr')).toBe('Bouira');
  });

  it('is empty for an absent city', () => {
    expect(formatCityLabel(null, 'fr')).toBe('');
    expect(formatCityLabel('', 'fr')).toBe('');
  });

  it('NEVER returns a raw code for a known city — the contract-slug guard', () => {
    for (const code of ['algiers', 'oran', 'setif', 'bejaia']) {
      for (const loc of ['en', 'fr', 'ar'] as const) {
        expect(formatCityLabel(code, loc)).not.toBe(code);
      }
    }
  });
});

describe('getCityName — unchanged fallback contract', () => {
  it('still returns the input untouched for an unknown code', () => {
    expect(getCityName('not-a-city', 'fr')).toBe('not-a-city');
  });
});

/* ─────────────── The full 58-wilaya set ─────────────── */

describe('the wilaya list', () => {
  it('carries all 58 official wilayas', () => {
    // Algeria went 48 → 58 in the 2019–2021 reform (ten southern wilayas
    // promoted from delegated status).
    expect(algerianCities).toHaveLength(58);
  });

  it('has no duplicate codes or names', () => {
    const codes = algerianCities.map((c) => c.code);
    expect(new Set(codes).size).toBe(58);
    expect(new Set(algerianCities.map((c) => c.nameFr)).size).toBe(58);
    expect(new Set(algerianCities.map((c) => c.nameAr)).size).toBe(58);
  });

  it('KEEPS every code that predates the full list — they are persisted', () => {
    // Renaming any of these would orphan every user/mentor/space/program/event
    // row that already stores it.
    const legacy = [
      'oran', 'algiers', 'constantine', 'annaba', 'blida', 'setif', 'batna',
      'tlemcen', 'bejaia', 'tiziouzou', 'skikda', 'mostaganem', 'biskra',
      'ghardaia', 'ouargla',
    ];
    // Widened to Set<string>: `code` is a literal union, and the point of this
    // test is to check plain strings against it.
    const codes = new Set<string>(algerianCities.map((c) => c.code));
    for (const code of legacy) expect(codes.has(code)).toBe(true);
  });

  it('every code round-trips through findCityCode', () => {
    for (const c of algerianCities) expect(findCityCode(c.code)).toBe(c.code);
  });

  it('every display name in every locale resolves back to its own code', () => {
    // Guards against two wilayas folding onto the same key.
    for (const c of algerianCities) {
      expect(findCityCode(c.nameFr)).toBe(c.code);
      expect(findCityCode(c.nameEn)).toBe(c.code);
      expect(findCityCode(c.nameAr)).toBe(c.code);
    }
  });

  it('every wilaya has a non-empty label in all three locales', () => {
    for (const c of algerianCities) {
      for (const loc of ['en', 'fr', 'ar'] as const) {
        expect(formatCityLabel(c.code, loc).length).toBeGreaterThan(0);
        expect(formatCityLabel(c.code, loc)).not.toBe(c.code);
      }
    }
  });

  it('now covers the wilayas the curated list used to exclude', () => {
    expect(findCityCode('Bouira')).toBe('bouira');
    expect(findCityCode('Tipaza')).toBe('tipaza');
    expect(findCityCode('Djelfa')).toBe('djelfa');
    expect(findCityCode('Touggourt')).toBe('touggourt');
    expect(findCityCode('El Meniaa')).toBe('elmeniaa');
  });
});
