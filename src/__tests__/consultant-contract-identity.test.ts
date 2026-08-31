/**
 * Consultant contract identity — the full address + national ID a consultant
 * fills in under profile settings, which the contract needs to name them as a
 * party.
 *
 * Covers the round trip the feature actually depends on:
 *   profile PATCH schema → updateMentor persistence → private DTO → contract.
 *
 * The "required" rule (owner decision 2026-08-31) is deliberately NOT a schema
 * requirement: `consultantProfileSchema` stays lenient so a partial save of an
 * unrelated section can't 422 on a field the consultant wasn't editing. It is
 * enforced where it matters — at contract creation — which is covered in
 * `consultant-contracts/service.test.ts`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db/store';
import { consultantProfileSchema } from '@/server/mentors/schemas';
import { updateMentor } from '@/server/mentors/service';
import { toMentorDto, toMentorPrivateDto } from '@/server/mentors/serialize';
import type { MentorRecord } from '@/server/db/store';

const MENTOR_ID = 'mentor-identity-1';

const MENTOR = {
  id: MENTOR_ID,
  fullName: 'Yasmine Belkacem',
  position: 'Expert-comptable',
  imageUrl: '',
  email: 'yasmine@example.dz',
  phone: '+213770112233',
  createdAt: new Date('2026-01-01').toISOString(),
} as unknown as MentorRecord;

beforeEach(async () => {
  await db.update((d) => {
    d.mentors = [{ ...MENTOR }];
  });
});

describe('consultantProfileSchema — address / idNumber', () => {
  it('accepts both fields', () => {
    const parsed = consultantProfileSchema.parse({
      address: '12 Rue Didouche Mourad, Alger Centre',
      idNumber: '109412345678',
    });
    expect(parsed.address).toBe('12 Rue Didouche Mourad, Alger Centre');
    expect(parsed.idNumber).toBe('109412345678');
  });

  it('stays lenient so an unrelated partial save never 422s', () => {
    // The portal saves one section at a time; omitting these must be fine.
    expect(() => consultantProfileSchema.parse({ bio: 'Just the bio.' })).not.toThrow();
  });

  it('allows clearing to null', () => {
    const parsed = consultantProfileSchema.parse({ address: null, idNumber: null });
    expect(parsed.address).toBeNull();
    expect(parsed.idNumber).toBeNull();
  });

  it('rejects an over-long address / id', () => {
    expect(() => consultantProfileSchema.parse({ address: 'x'.repeat(301) })).toThrow();
    expect(() => consultantProfileSchema.parse({ idNumber: 'x'.repeat(61) })).toThrow();
  });
});

describe('updateMentor — persistence', () => {
  it('persists both fields', async () => {
    const result = await updateMentor(MENTOR_ID, {
      address: '12 Rue Didouche Mourad, Alger Centre',
      idNumber: '109412345678',
    });
    expect(result.ok).toBe(true);
    const stored = (await db.read()).mentors.find((m) => m.id === MENTOR_ID)!;
    expect(stored.address).toBe('12 Rue Didouche Mourad, Alger Centre');
    expect(stored.idNumber).toBe('109412345678');
  });

  it('trims, and turns a blank into null rather than an empty string', async () => {
    await updateMentor(MENTOR_ID, { address: '  12 Rue Didouche  ', idNumber: '   ' });
    const stored = (await db.read()).mentors.find((m) => m.id === MENTOR_ID)!;
    expect(stored.address).toBe('12 Rue Didouche');
    expect(stored.idNumber).toBeNull();
  });

  it('leaves them untouched when the patch omits them', async () => {
    await updateMentor(MENTOR_ID, { address: 'Somewhere', idNumber: '123' });
    await updateMentor(MENTOR_ID, { bio: 'new bio' });
    const stored = (await db.read()).mentors.find((m) => m.id === MENTOR_ID)!;
    expect(stored.address).toBe('Somewhere');
    expect(stored.idNumber).toBe('123');
  });
});

describe('serialization — these are PRIVATE', () => {
  it('the private DTO carries them so the profile form can round-trip', async () => {
    await updateMentor(MENTOR_ID, { address: 'Rue X', idNumber: '999' });
    const stored = (await db.read()).mentors.find((m) => m.id === MENTOR_ID)!;
    const dto = toMentorPrivateDto(stored);
    expect(dto.address).toBe('Rue X');
    expect(dto.idNumber).toBe('999');
  });

  it('the PUBLIC DTO leaks neither — a national ID must never reach a public route', async () => {
    await updateMentor(MENTOR_ID, { address: 'Rue X', idNumber: '999' });
    const stored = (await db.read()).mentors.find((m) => m.id === MENTOR_ID)!;
    const dto = toMentorDto(stored) as unknown as Record<string, unknown>;
    expect(dto.address).toBeUndefined();
    expect(dto.idNumber).toBeUndefined();
    expect(JSON.stringify(dto)).not.toContain('999');
  });
});
