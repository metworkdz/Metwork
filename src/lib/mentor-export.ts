/**
 * Pure, dependency-free builders for the admin Mentors page exports. Kept out of
 * the client component so the CSV escaping + email de-duplication are trivially
 * unit-testable (no React/DOM). The component owns only the Blob download.
 */
import type { Mentor } from '@/types/mentor';

/** Escape one CSV cell — quote when it contains a comma, quote or newline. */
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build the mentors CSV (all rows). Header + one row per mentor, every cell
 * escaped, CRLF line endings. Prepends a UTF-8 BOM so Excel renders
 * accented/Arabic names correctly. An empty list yields the header row only.
 */
export function buildMentorsCsv(mentors: Mentor[]): string {
  const header = ['Full name', 'Email', 'Position', 'Consultation fee (DZD)', 'LinkedIn', 'Created at'];
  const rows = mentors.map((m) =>
    [
      m.fullName,
      m.email ?? '',
      m.position,
      m.consultationFee && m.consultationFee > 0 ? m.consultationFee : '',
      m.linkedinUrl ?? '',
      m.createdAt,
    ]
      .map(csvCell)
      .join(','),
  );
  return '\uFEFF' + [header.map(csvCell).join(','), ...rows].join('\r\n');
}

/**
 * Build a clean, de-duplicated (case-insensitive), newline-separated list of
 * mentor emails — null/empty entries dropped. Newline-separated is the most
 * universal for pasting into a mail client's "To:" field.
 */
export function buildMentorEmails(mentors: Mentor[]): string {
  const seen = new Set<string>();
  const emails: string[] = [];
  for (const m of mentors) {
    const email = (m.email ?? '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(email);
  }
  return emails.join('\n');
}
