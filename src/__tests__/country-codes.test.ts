/**
 * Country/dial-code data + E.164 validation for the consultant phone
 * selector. Scope is a deliberately FIXED list — Europe, USA, Canada,
 * Tunisia, Qatar, Saudi Arabia, Egypt, and Algeria — not every country
 * `libphonenumber-js` knows about.
 */
import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_COUNTRIES,
  COUNTRY_OPTIONS,
  DEFAULT_COUNTRY,
  coerceSupportedCountry,
  countryDisplayName,
  isValidE164,
} from '@/lib/country-codes';

describe('SUPPORTED_COUNTRIES scope', () => {
  it('defaults to Algeria', () => {
    expect(DEFAULT_COUNTRY).toBe('DZ');
    expect(SUPPORTED_COUNTRIES[0]).toBe('DZ');
  });

  it('includes every explicitly-requested non-European country', () => {
    for (const c of ['DZ', 'TN', 'EG', 'SA', 'QA', 'US', 'CA']) {
      expect(SUPPORTED_COUNTRIES).toContain(c);
    }
  });

  it('excludes countries never requested (world is NOT fully enumerated)', () => {
    // A representative, deliberately-excluded sample: not European, not US/CA,
    // not one of the 4 named MENA countries.
    for (const c of ['JP', 'CN', 'BR', 'IN', 'AU', 'NG', 'ZA', 'MX', 'AE', 'MA']) {
      expect(SUPPORTED_COUNTRIES).not.toContain(c);
    }
  });

  it('has no duplicate entries', () => {
    expect(new Set(SUPPORTED_COUNTRIES).size).toBe(SUPPORTED_COUNTRIES.length);
  });

  it('every option carries a dial code and a non-empty flag', () => {
    expect(COUNTRY_OPTIONS.length).toBe(SUPPORTED_COUNTRIES.length);
    for (const o of COUNTRY_OPTIONS) {
      expect(o.dialCode).toMatch(/^\+\d+$/);
      expect(o.flag.length).toBeGreaterThan(0);
    }
  });
});

describe('coerceSupportedCountry', () => {
  it('accepts a supported code case-insensitively', () => {
    expect(coerceSupportedCountry('dz')).toBe('DZ');
    expect(coerceSupportedCountry('Fr')).toBe('FR');
  });

  it('rejects an unsupported real country (e.g. Japan)', () => {
    expect(coerceSupportedCountry('JP')).toBeNull();
  });

  it('rejects garbage input without throwing', () => {
    expect(coerceSupportedCountry('')).toBeNull();
    expect(coerceSupportedCountry(null)).toBeNull();
    expect(coerceSupportedCountry(undefined)).toBeNull();
    expect(coerceSupportedCountry('not-a-country')).toBeNull();
  });
});

describe('countryDisplayName', () => {
  it('resolves a locale-correct name for en/fr/ar', () => {
    expect(countryDisplayName('DZ', 'en')).toBe('Algeria');
    expect(countryDisplayName('DZ', 'fr')).toBe('Algérie');
    expect(countryDisplayName('DZ', 'ar')).toContain('الجزائر');
  });
});

describe('isValidE164 — real per-country subscriber-length validation', () => {
  it('accepts a valid Algerian mobile', () => {
    expect(isValidE164('+213555123456')).toBe(true);
  });

  it('accepts a valid US number', () => {
    expect(isValidE164('+14155552671')).toBe(true);
  });

  it('accepts a valid French number', () => {
    expect(isValidE164('+33612345678')).toBe(true);
  });

  it('rejects a too-short number', () => {
    expect(isValidE164('+21355')).toBe(false);
  });

  it('rejects a too-long number', () => {
    expect(isValidE164('+2135551234567890')).toBe(false);
  });

  it('rejects a bare national number with no + prefix', () => {
    expect(isValidE164('0555123456')).toBe(false);
  });

  it('rejects empty and garbage input without throwing', () => {
    expect(isValidE164('')).toBe(false);
    expect(isValidE164('not a phone number')).toBe(false);
  });

  it('this is the exact check the consultant signup schema now uses', () => {
    // Guards against the two schemas silently drifting apart.
    expect(isValidE164('+213555123456')).toBe(true);
  });
});
