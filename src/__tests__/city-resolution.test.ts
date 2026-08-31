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
import { findCityCode, formatCityLabel, getCityName } from '@/config/cities';

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

  it('returns null for a wilaya not in the list, rather than guessing', () => {
    // Algeria has 58 wilayas; the picker deliberately carries a curated subset.
    expect(findCityCode('Bouira')).toBeNull();
    expect(findCityCode('')).toBeNull();
    expect(findCityCode(null)).toBeNull();
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
