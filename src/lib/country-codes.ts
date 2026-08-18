/**
 * Country + dial-code data for the consultant signup phone selector.
 *
 * Deliberately a FIXED, curated list — not every country
 * `libphonenumber-js` supports. Scope: Europe (sovereign states), USA,
 * Canada, Tunisia, Qatar, Saudi Arabia, Egypt, and Algeria (the default).
 * Extending this list later is a one-line addition to `SUPPORTED_COUNTRIES`.
 *
 * Pure data + validation logic, no React — reusable outside the consultant
 * portal if a later prompt asks for it, and unit-testable in isolation.
 */
import { getCountryCallingCode, isValidPhoneNumber, type CountryCode } from 'libphonenumber-js';

/** ISO 3166-1 alpha-2 codes this selector offers, in display order. */
export const SUPPORTED_COUNTRIES = [
  // Algeria first — the platform's home market and the default selection.
  'DZ',
  // North Africa / Middle East (explicitly requested, beyond Europe/NA).
  'TN', 'EG', 'SA', 'QA',
  // North America.
  'US', 'CA',
  // Europe (sovereign states).
  'AL', 'AD', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE',
  'FI', 'FR', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU',
  'MT', 'MD', 'MC', 'ME', 'NL', 'MK', 'NO', 'PL', 'PT', 'RO', 'RU', 'SM',
  'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'UA', 'GB', 'VA',
] as const satisfies readonly CountryCode[];

export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

/** Algeria — the platform's default market, used when geolocation is absent/inconclusive. */
export const DEFAULT_COUNTRY: SupportedCountry = 'DZ';

function isSupportedCountry(code: string): code is SupportedCountry {
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(code);
}

/** Narrow an arbitrary (e.g. header-sourced) string to a supported country, or null. */
export function coerceSupportedCountry(code: string | null | undefined): SupportedCountry | null {
  if (!code) return null;
  const upper = code.trim().toUpperCase();
  return isSupportedCountry(upper) ? upper : null;
}

export interface CountryOption {
  code: SupportedCountry;
  dialCode: string;
  flag: string;
}

/** Emoji flag from an ISO 3166-1 alpha-2 code — Unicode regional-indicator offset, no image assets. */
function flagEmoji(iso: string): string {
  return [...iso.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
}

/** Static list — dial codes and flags never change at runtime. */
export const COUNTRY_OPTIONS: CountryOption[] = SUPPORTED_COUNTRIES.map((code) => ({
  code,
  dialCode: `+${getCountryCallingCode(code)}`,
  flag: flagEmoji(code),
}));

/**
 * Locale-correct display name for a supported country. `Intl.DisplayNames`
 * is a native platform API — no per-locale country-name data to maintain.
 * Falls back to the bare ISO code if a runtime somehow lacks the locale's
 * region data (never throws).
 */
export function countryDisplayName(code: SupportedCountry, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * E.164 validity for a full phone string (e.g. "+213555000111") against its
 * OWN embedded dial code — `libphonenumber-js` reads the country from the
 * `+` prefix, so the selected country only needs to have produced that
 * prefix; this does not re-derive validity from a separately-passed country.
 */
export function isValidE164(phone: string): boolean {
  try {
    return isValidPhoneNumber(phone);
  } catch {
    return false;
  }
}
