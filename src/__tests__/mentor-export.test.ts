/**
 * Admin Mentors page exports — pure builders (src/lib/mentor-export.ts).
 * Covers CSV escaping (commas/quotes/newlines), the UTF-8 BOM, unset-fee
 * handling, the empty-roster case, and the de-duplicated email list.
 */
import { describe, it, expect } from 'vitest';
import { buildMentorsCsv, buildMentorEmails, csvCell } from '@/lib/mentor-export';
import type { Mentor } from '@/types/mentor';

const HEADER = 'Full name,Email,Position,Consultation fee (DZD),LinkedIn,Created at';

function mentor(over: Partial<Mentor>): Mentor {
  return {
    fullName: 'X', position: 'Advisor', email: 'x@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as Mentor;
}

describe('csvCell', () => {
  it('quotes cells with commas/quotes/newlines and doubles internal quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(12000)).toBe('12000');
  });
});

describe('buildMentorsCsv', () => {
  it('emits a BOM + header, then one CRLF-delimited row per mentor (comma in name quoted)', () => {
    const csv = buildMentorsCsv([
      mentor({ fullName: 'Sara, PhD', email: 'sara@x.io', position: 'Advisor', consultationFee: 8000, linkedinUrl: 'https://ln/sara', createdAt: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('"Sara, PhD",sara@x.io,Advisor,8000,https://ln/sara,2026-06-01T00:00:00.000Z');
  });

  it('leaves an unset/zero fee and a null email blank (not 0/undefined)', () => {
    const csv = buildMentorsCsv([mentor({ fullName: 'No Fee', email: null, position: 'Advisor', consultationFee: 0, linkedinUrl: null })]);
    expect(csv.slice(1).split('\r\n')[1]).toBe('No Fee,,Advisor,,,2026-01-01T00:00:00.000Z');
  });

  it('with zero mentors, emits only the BOM + header (no crash)', () => {
    expect(buildMentorsCsv([])).toBe('\uFEFF' + HEADER);
  });
});

describe('buildMentorEmails', () => {
  it('dedupes case-insensitively, drops null/empty, trims, newline-separated', () => {
    const out = buildMentorEmails([
      mentor({ email: 'a@x.io' }),
      mentor({ email: 'A@X.io' }), // case-insensitive dup
      mentor({ email: '  b@x.io ' }), // trimmed
      mentor({ email: null }), // dropped
      mentor({ email: '' }), // dropped
      mentor({ email: 'c@x.io' }),
    ]);
    expect(out).toBe('a@x.io\nb@x.io\nc@x.io');
  });

  it('returns an empty string for zero mentors', () => {
    expect(buildMentorEmails([])).toBe('');
  });
});
