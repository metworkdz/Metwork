/**
 * consultantSignupSchema.phone — now real E.164 validity (per-country
 * subscriber-number length), replacing the old loose character/format regex.
 */
import { describe, it, expect } from 'vitest';
import { consultantSignupSchema } from '@/server/mentors/schemas';

const BASE = {
  fullName: 'Sara Consultant',
  position: 'Growth Advisor',
  email: 'sara@example.com',
  acceptPrivacy: true as const,
};

function parse(phone: string) {
  return consultantSignupSchema.safeParse({ ...BASE, phone });
}

describe('consultantSignupSchema.phone — E.164 validation', () => {
  it('accepts a real Algerian mobile (the existing default market)', () => {
    expect(parse('+213555000111').success).toBe(true);
  });

  it('accepts real numbers from other supported countries', () => {
    expect(parse('+14155552671').success).toBe(true); // US
    expect(parse('+33612345678').success).toBe(true); // FR
    expect(parse('+201001234567').success).toBe(true); // EG
  });

  it('rejects a too-short number that the old loose regex would have accepted', () => {
    // 6 chars, matches the OLD /^\+?[0-9\s().-]{6,30}$/ regex but is not a real number.
    const res = parse('+21355');
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]?.message).toBe('invalidPhone');
    }
  });

  it('rejects a bare national number with no country prefix', () => {
    expect(parse('0555000111').success).toBe(false);
  });

  it('rejects garbage', () => {
    expect(parse('not a phone number').success).toBe(false);
  });
});
