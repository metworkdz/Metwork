/** Number and length formatting shared by the Academy pages. */
export function formatDzd(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-US').format(n);
}

type T = (key: string, values?: Record<string, number>) => string;

/** "2 h 10", "14 min", "45 s" — via i18n so Arabic gets its own units. */
export function formatDuration(sec: number, t: T): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h) return t('duration.hm', { h, m });
  if (m) return t('duration.m', { m });
  return t('duration.s', { s: sec });
}

/** Lesson length as 2:41. */
export function formatClock(sec: number): string {
  if (sec <= 0) return '';
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}
