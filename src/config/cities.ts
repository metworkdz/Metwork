/**
 * Algerian wilayas (provinces) — ordered by population/relevance for startup ecosystem.
 * Used in: signup form, space filtering, booking system.
 */
export const algerianCities = [
  { code: 'oran', nameEn: 'Oran', nameFr: 'Oran', nameAr: 'وهران' },
  { code: 'algiers', nameEn: 'Algiers', nameFr: 'Alger', nameAr: 'الجزائر' },
  { code: 'constantine', nameEn: 'Constantine', nameFr: 'Constantine', nameAr: 'قسنطينة' },
  { code: 'annaba', nameEn: 'Annaba', nameFr: 'Annaba', nameAr: 'عنابة' },
  { code: 'blida', nameEn: 'Blida', nameFr: 'Blida', nameAr: 'البليدة' },
  { code: 'setif', nameEn: 'Sétif', nameFr: 'Sétif', nameAr: 'سطيف' },
  { code: 'batna', nameEn: 'Batna', nameFr: 'Batna', nameAr: 'باتنة' },
  { code: 'tlemcen', nameEn: 'Tlemcen', nameFr: 'Tlemcen', nameAr: 'تلمسان' },
  { code: 'bejaia', nameEn: 'Béjaïa', nameFr: 'Béjaïa', nameAr: 'بجاية' },
  { code: 'tiziouzou', nameEn: 'Tizi Ouzou', nameFr: 'Tizi Ouzou', nameAr: 'تيزي وزو' },
  { code: 'skikda', nameEn: 'Skikda', nameFr: 'Skikda', nameAr: 'سكيكدة' },
  { code: 'mostaganem', nameEn: 'Mostaganem', nameFr: 'Mostaganem', nameAr: 'مستغانم' },
  { code: 'biskra', nameEn: 'Biskra', nameFr: 'Biskra', nameAr: 'بسكرة' },
  { code: 'ghardaia', nameEn: 'Ghardaïa', nameFr: 'Ghardaïa', nameAr: 'غرداية' },
  { code: 'ouargla', nameEn: 'Ouargla', nameFr: 'Ouargla', nameAr: 'ورقلة' },
] as const;

export type AlgerianCityCode = (typeof algerianCities)[number]['code'];

export function getCityName(code: string, locale: 'en' | 'fr' | 'ar'): string {
  const city = algerianCities.find((c) => c.code === code);
  if (!city) return code;
  if (locale === 'ar') return city.nameAr;
  if (locale === 'fr') return city.nameFr;
  return city.nameEn;
}

/**
 * Strip accents + case so "Sétif", "setif" and "SETIF" all compare equal.
 * NFD splits an accented letter into base + combining mark; the range below
 * removes the marks.
 */
function fold(value: string): string {
  return value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Resolve any stored city value to its canonical code.
 *
 * Accepts a code ('algiers') or a display name in ANY locale ('Alger',
 * 'Algiers', 'الجزائر'), accent- and case-insensitively. Returns null when the
 * value matches no known wilaya.
 *
 * Exists because several records predate the dropdown and hold free text the
 * user typed. Those values must keep working — both so the picker can
 * pre-select the right option instead of appearing empty, and so a legacy value
 * is never silently overwritten just because it was stored as a name.
 */
export function findCityCode(value: string | null | undefined): AlgerianCityCode | null {
  if (!value) return null;
  const needle = fold(value);
  const match = algerianCities.find(
    (c) =>
      c.code === needle ||
      fold(c.nameEn) === needle ||
      fold(c.nameFr) === needle ||
      c.nameAr.trim() === value.trim(),
  );
  return match?.code ?? null;
}

/**
 * Display label for a stored city value, whatever form it is in.
 *
 * A known code or name resolves to the localized wilaya name; anything else
 * (legacy free text for a wilaya not in the list) is returned unchanged rather
 * than blanked — showing what the user actually typed beats showing nothing.
 */
export function formatCityLabel(
  value: string | null | undefined,
  locale: 'en' | 'fr' | 'ar',
): string {
  if (!value) return '';
  const code = findCityCode(value);
  return code ? getCityName(code, locale) : value;
}
