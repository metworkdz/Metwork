/**
 * Spell an integer money amount in words (French / English), for the "Total payé :
 * … dinars" line on receipts. Handles 0 … 999,999,999 — far beyond any realistic
 * DZD receipt total. Decimals are rounded away (receipts are whole-dinar).
 */

const FR_UNITS = [
  '', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];
const FR_TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];

function frBelow100(n: number): string {
  if (n < 20) return FR_UNITS[n]!;
  const t = Math.floor(n / 10);
  const u = n % 10;
  if (t === 7 || t === 9) {
    // 70–79 → soixante + 10..19 ; 90–99 → quatre-vingt + 10..19
    const base = t === 7 ? 'soixante' : 'quatre-vingt';
    if (t === 7 && u === 1) return 'soixante et onze';
    return `${base}-${FR_UNITS[10 + u]}`;
  }
  const tens = FR_TENS[t]!;
  if (u === 0) return t === 8 ? 'quatre-vingts' : tens; // 80 keeps the plural s
  if (u === 1 && t >= 2 && t <= 6) return `${tens} et un`; // 21, 31 … 61
  return `${tens}-${FR_UNITS[u]}`;
}

function frBelow1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = '';
  if (h > 0) {
    out = h === 1 ? 'cent' : `${FR_UNITS[h]} cent`;
    if (r === 0 && h > 1) out += 's'; // "cents" only when nothing follows
  }
  if (r > 0) out = out ? `${out} ${frBelow100(r)}` : frBelow100(r);
  return out;
}

function frenchWords(n: number): string {
  if (n === 0) return 'zéro';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(millions === 1 ? 'un million' : `${frBelow1000(millions)} millions`);
  if (thousands > 0) parts.push(thousands === 1 ? 'mille' : `${frBelow1000(thousands)} mille`);
  if (rest > 0) parts.push(frBelow1000(rest));
  return parts.join(' ');
}

const EN_UNITS = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function enBelow100(n: number): string {
  if (n < 20) return EN_UNITS[n]!;
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? EN_TENS[t]! : `${EN_TENS[t]}-${EN_UNITS[u]}`;
}

function enBelow1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let out = '';
  if (h > 0) out = `${EN_UNITS[h]} hundred`;
  if (r > 0) out = out ? `${out} ${enBelow100(r)}` : enBelow100(r);
  return out;
}

function englishWords(n: number): string {
  if (n === 0) return 'zero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(`${enBelow1000(millions)} million`);
  if (thousands > 0) parts.push(`${enBelow1000(thousands)} thousand`);
  if (rest > 0) parts.push(enBelow1000(rest));
  return parts.join(' ');
}

/** Spell `amount` in words for the receipt total line. Caller appends "dinars". */
export function amountInWords(amount: number, lang: 'fr' | 'en'): string {
  const n = Math.round(Math.abs(amount));
  if (n > 999_999_999) return String(n); // out of range — fall back to digits
  return lang === 'fr' ? frenchWords(n) : englishWords(n);
}
