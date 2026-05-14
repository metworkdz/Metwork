/**
 * URL-safe slug generator.
 *
 * Converts a free-text title into a lowercase, hyphen-separated,
 * ASCII-only string suitable for use in URLs.
 *
 * Examples:
 *   slugify("Startup Bootcamp — Oran 2025!")  → "startup-bootcamp-oran-2025"
 *   slugify("برنامج تسريع الشركات")            → "brnmj-tsry-alshrkht" (transliteration)
 */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')                    // decompose accented chars
    .replace(/[̀-ͯ]/g, '')      // strip diacritic marks
    // Basic Arabic transliteration — keeps it meaningful for Arabic titles
    .replace(/[؀-ۿ]/g, (c) => arabicToLatin(c))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')        // drop non-alphanumeric
    .trim()
    .replace(/[\s_]+/g, '-')             // spaces/underscores → hyphens
    .replace(/-{2,}/g, '-')              // collapse multiple hyphens
    .replace(/^-+|-+$/g, '');            // strip leading/trailing hyphens
}

/**
 * Ensure a slug is unique within a list of existing slugs.
 * Appends "-2", "-3", … until unique.
 */
export function uniqueSlug(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

// ---------------------------------------------------------------------------
// Arabic transliteration table (partial — covers common letters)
// ---------------------------------------------------------------------------

const ARABIC_MAP: Record<string, string> = {
  'ا': 'a',  // ا
  'ب': 'b',  // ب
  'ت': 't',  // ت
  'ث': 'th', // ث
  'ج': 'j',  // ج
  'ح': 'h',  // ح
  'خ': 'kh', // خ
  'د': 'd',  // د
  'ذ': 'dh', // ذ
  'ر': 'r',  // ر
  'ز': 'z',  // ز
  'س': 's',  // س
  'ش': 'sh', // ش
  'ص': 's',  // ص
  'ض': 'd',  // ض
  'ط': 't',  // ط
  'ظ': 'z',  // ظ
  'ع': '',   // ع (ayn — drop)
  'غ': 'gh', // غ
  'ف': 'f',  // ف
  'ق': 'q',  // ق
  'ك': 'k',  // ك
  'ل': 'l',  // ل
  'م': 'm',  // م
  'ن': 'n',  // ن
  'ه': 'h',  // ه
  'و': 'w',  // و
  'ي': 'y',  // ي
  'ة': 'h',  // ة
  'ء': '',   // ء hamza (drop)
  'أ': 'a',  // أ
  'إ': 'i',  // إ
  'آ': 'a',  // آ
  'ؤ': 'w',  // ؤ
  'ئ': 'y',  // ئ
};

function arabicToLatin(char: string): string {
  return ARABIC_MAP[char] ?? char;
}
