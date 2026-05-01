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
