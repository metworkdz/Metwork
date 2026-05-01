import type { Locale } from '@/i18n/config';

/**
 * Format an amount as DZD currency.
 * Algerian Dinar uses no decimal places by convention for whole-currency display.
 */
export function formatCurrency(
  amount: number,
  locale: Locale = 'en',
  options: { withSymbol?: boolean } = {},
): string {
  const { withSymbol = true } = options;
  const localeMap: Record<Locale, string> = {
    en: 'en-DZ',
    fr: 'fr-DZ',
    ar: 'ar-DZ',
  };

  const formatter = new Intl.NumberFormat(localeMap[locale], {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });

  const formatted = formatter.format(amount);
  if (!withSymbol) return formatted;

  if (locale === 'fr') return `${formatted} DZD`;
  if (locale === 'ar') return `${formatted} د.ج`;
  return `${formatted} DZD`;
}

/**
 * Format a date in the user's locale.
 */
export function formatDate(
  date: Date | string,
  locale: Locale = 'en',
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const localeMap: Record<Locale, string> = {
    en: 'en-GB',
    fr: 'fr-FR',
    ar: 'ar-DZ',
  };
  return new Intl.DateTimeFormat(localeMap[locale], options).format(d);
}

/**
 * Format a relative time string (e.g. "2 hours ago", "in 3 days").
 */
export function formatRelativeTime(date: Date | string, locale: Locale = 'en'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const localeMap: Record<Locale, string> = {
    en: 'en',
    fr: 'fr',
    ar: 'ar',
  };
  const rtf = new Intl.RelativeTimeFormat(localeMap[locale], { numeric: 'auto' });

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, 'second');
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute');
  if (Math.abs(diffHour) < 24) return rtf.format(diffHour, 'hour');
  return rtf.format(diffDay, 'day');
}

/**
 * Format a large number compactly (e.g. 1500 → "1.5K").
 */
export function formatCompactNumber(value: number, locale: Locale = 'en'): string {
  const localeMap: Record<Locale, string> = {
    en: 'en',
    fr: 'fr',
    ar: 'ar',
  };
  return new Intl.NumberFormat(localeMap[locale], {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
