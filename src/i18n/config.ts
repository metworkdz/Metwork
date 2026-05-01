export const locales = ['en', 'fr', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeMetadata: Record<
  Locale,
  { name: string; nativeName: string; dir: 'ltr' | 'rtl'; flag: string }
> = {
  en: { name: 'English', nativeName: 'English', dir: 'ltr', flag: '🇬🇧' },
  fr: { name: 'French', nativeName: 'Français', dir: 'ltr', flag: '🇫🇷' },
  ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl', flag: '🇩🇿' },
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function getDirection(locale: string): 'ltr' | 'rtl' {
  if (isLocale(locale)) return localeMetadata[locale].dir;
  return 'ltr';
}
