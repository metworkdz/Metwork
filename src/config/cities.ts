/**
 * The 58 wilayas (provinces) of Algeria, in official wilaya-number order (01
 * Adrar → 58 El Meniaa). Algeria moved from 48 to 58 in the 2019–2021 reform
 * that promoted the ten southern delegated wilayas.
 *
 * Used in: signup, entrepreneur/consultant profiles, space & program & event
 * forms, and public filters.
 *
 * `code` IS PERSISTED on user/mentor/space/program/event records — it is the
 * stored value everywhere, and only the label is localized. Never rename a
 * code: it would orphan every row holding it. The 15 codes that predate the
 * full list ('algiers', 'tiziouzou', 'setif', …) are deliberately kept in their
 * original spelling for exactly that reason, even where a fresh list would have
 * spelled them differently.
 */
export const algerianCities = [
  { code: 'adrar', nameEn: 'Adrar', nameFr: 'Adrar', nameAr: 'أدرار' }, // 01
  { code: 'chlef', nameEn: 'Chlef', nameFr: 'Chlef', nameAr: 'الشلف' }, // 02
  { code: 'laghouat', nameEn: 'Laghouat', nameFr: 'Laghouat', nameAr: 'الأغواط' }, // 03
  { code: 'oumelbouaghi', nameEn: 'Oum El Bouaghi', nameFr: 'Oum El Bouaghi', nameAr: 'أم البواقي' }, // 04
  { code: 'batna', nameEn: 'Batna', nameFr: 'Batna', nameAr: 'باتنة' }, // 05
  { code: 'bejaia', nameEn: 'Bejaia', nameFr: 'Béjaïa', nameAr: 'بجاية' }, // 06
  { code: 'biskra', nameEn: 'Biskra', nameFr: 'Biskra', nameAr: 'بسكرة' }, // 07
  { code: 'bechar', nameEn: 'Bechar', nameFr: 'Béchar', nameAr: 'بشار' }, // 08
  { code: 'blida', nameEn: 'Blida', nameFr: 'Blida', nameAr: 'البليدة' }, // 09
  { code: 'bouira', nameEn: 'Bouira', nameFr: 'Bouira', nameAr: 'البويرة' }, // 10
  { code: 'tamanrasset', nameEn: 'Tamanrasset', nameFr: 'Tamanrasset', nameAr: 'تمنراست' }, // 11
  { code: 'tebessa', nameEn: 'Tebessa', nameFr: 'Tébessa', nameAr: 'تبسة' }, // 12
  { code: 'tlemcen', nameEn: 'Tlemcen', nameFr: 'Tlemcen', nameAr: 'تلمسان' }, // 13
  { code: 'tiaret', nameEn: 'Tiaret', nameFr: 'Tiaret', nameAr: 'تيارت' }, // 14
  { code: 'tiziouzou', nameEn: 'Tizi Ouzou', nameFr: 'Tizi Ouzou', nameAr: 'تيزي وزو' }, // 15
  { code: 'algiers', nameEn: 'Algiers', nameFr: 'Alger', nameAr: 'الجزائر' }, // 16
  { code: 'djelfa', nameEn: 'Djelfa', nameFr: 'Djelfa', nameAr: 'الجلفة' }, // 17
  { code: 'jijel', nameEn: 'Jijel', nameFr: 'Jijel', nameAr: 'جيجل' }, // 18
  { code: 'setif', nameEn: 'Setif', nameFr: 'Sétif', nameAr: 'سطيف' }, // 19
  { code: 'saida', nameEn: 'Saida', nameFr: 'Saïda', nameAr: 'سعيدة' }, // 20
  { code: 'skikda', nameEn: 'Skikda', nameFr: 'Skikda', nameAr: 'سكيكدة' }, // 21
  { code: 'sidibelabbes', nameEn: 'Sidi Bel Abbes', nameFr: 'Sidi Bel Abbès', nameAr: 'سيدي بلعباس' }, // 22
  { code: 'annaba', nameEn: 'Annaba', nameFr: 'Annaba', nameAr: 'عنابة' }, // 23
  { code: 'guelma', nameEn: 'Guelma', nameFr: 'Guelma', nameAr: 'قالمة' }, // 24
  { code: 'constantine', nameEn: 'Constantine', nameFr: 'Constantine', nameAr: 'قسنطينة' }, // 25
  { code: 'medea', nameEn: 'Medea', nameFr: 'Médéa', nameAr: 'المدية' }, // 26
  { code: 'mostaganem', nameEn: 'Mostaganem', nameFr: 'Mostaganem', nameAr: 'مستغانم' }, // 27
  { code: 'msila', nameEn: "M'Sila", nameFr: "M'Sila", nameAr: 'المسيلة' }, // 28
  { code: 'mascara', nameEn: 'Mascara', nameFr: 'Mascara', nameAr: 'معسكر' }, // 29
  { code: 'ouargla', nameEn: 'Ouargla', nameFr: 'Ouargla', nameAr: 'ورقلة' }, // 30
  { code: 'oran', nameEn: 'Oran', nameFr: 'Oran', nameAr: 'وهران' }, // 31
  { code: 'elbayadh', nameEn: 'El Bayadh', nameFr: 'El Bayadh', nameAr: 'البيض' }, // 32
  { code: 'illizi', nameEn: 'Illizi', nameFr: 'Illizi', nameAr: 'إليزي' }, // 33
  { code: 'bordjbouarreridj', nameEn: 'Bordj Bou Arreridj', nameFr: 'Bordj Bou Arréridj', nameAr: 'برج بوعريريج' }, // 34
  { code: 'boumerdes', nameEn: 'Boumerdes', nameFr: 'Boumerdès', nameAr: 'بومرداس' }, // 35
  { code: 'eltarf', nameEn: 'El Tarf', nameFr: 'El Tarf', nameAr: 'الطارف' }, // 36
  { code: 'tindouf', nameEn: 'Tindouf', nameFr: 'Tindouf', nameAr: 'تندوف' }, // 37
  { code: 'tissemsilt', nameEn: 'Tissemsilt', nameFr: 'Tissemsilt', nameAr: 'تيسمسيلت' }, // 38
  { code: 'eloued', nameEn: 'El Oued', nameFr: 'El Oued', nameAr: 'الوادي' }, // 39
  { code: 'khenchela', nameEn: 'Khenchela', nameFr: 'Khenchela', nameAr: 'خنشلة' }, // 40
  { code: 'soukahras', nameEn: 'Souk Ahras', nameFr: 'Souk Ahras', nameAr: 'سوق أهراس' }, // 41
  { code: 'tipaza', nameEn: 'Tipaza', nameFr: 'Tipaza', nameAr: 'تيبازة' }, // 42
  { code: 'mila', nameEn: 'Mila', nameFr: 'Mila', nameAr: 'ميلة' }, // 43
  { code: 'aindefla', nameEn: 'Ain Defla', nameFr: 'Aïn Defla', nameAr: 'عين الدفلى' }, // 44
  { code: 'naama', nameEn: 'Naama', nameFr: 'Naâma', nameAr: 'النعامة' }, // 45
  { code: 'aintemouchent', nameEn: 'Ain Temouchent', nameFr: 'Aïn Témouchent', nameAr: 'عين تموشنت' }, // 46
  { code: 'ghardaia', nameEn: 'Ghardaia', nameFr: 'Ghardaïa', nameAr: 'غرداية' }, // 47
  { code: 'relizane', nameEn: 'Relizane', nameFr: 'Relizane', nameAr: 'غليزان' }, // 48
  { code: 'timimoun', nameEn: 'Timimoun', nameFr: 'Timimoun', nameAr: 'تيميمون' }, // 49
  { code: 'bordjbadjimokhtar', nameEn: 'Bordj Badji Mokhtar', nameFr: 'Bordj Badji Mokhtar', nameAr: 'برج باجي مختار' }, // 50
  { code: 'ouleddjellal', nameEn: 'Ouled Djellal', nameFr: 'Ouled Djellal', nameAr: 'أولاد جلال' }, // 51
  { code: 'beniabbes', nameEn: 'Beni Abbes', nameFr: 'Béni Abbès', nameAr: 'بني عباس' }, // 52
  { code: 'insalah', nameEn: 'In Salah', nameFr: 'In Salah', nameAr: 'عين صالح' }, // 53
  { code: 'inguezzam', nameEn: 'In Guezzam', nameFr: 'In Guezzam', nameAr: 'عين قزام' }, // 54
  { code: 'touggourt', nameEn: 'Touggourt', nameFr: 'Touggourt', nameAr: 'تقرت' }, // 55
  { code: 'djanet', nameEn: 'Djanet', nameFr: 'Djanet', nameAr: 'جانت' }, // 56
  { code: 'elmghair', nameEn: "El M'Ghair", nameFr: "El M'Ghair", nameAr: 'المغير' }, // 57
  { code: 'elmeniaa', nameEn: 'El Meniaa', nameFr: 'El Meniaa', nameAr: 'المنيعة' }, // 58
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
 * Normalize a city string for comparison: strip accents, case, and the
 * separators people vary on — so "Sétif"/"setif"/"SETIF",
 * "M'Sila"/"M’Sila"/"Msila", "El Oued"/"el-oued" and
 * "Bordj Bou Arréridj"/"bordjbouarreridj" all compare equal.
 *
 * NFD splits an accented letter into base + combining mark; the \u0300-\u036f
 * range removes those marks. Arabic letters and Arabic diacritics
 * (\u064b-\u0652) are untouched by both steps, so Arabic names fold safely to
 * themselves minus spaces — no cross-script collisions.
 */
function fold(value: string): string {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019\-_.\s]/g, '')
    .toLowerCase();
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
      fold(c.nameAr) === needle,
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
