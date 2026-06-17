import { randomUUID } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import type { CreateMentorInput, UpdateMentorInput, MentorAvailabilityPatch } from './schemas';
import { DEFAULT_AVAILABILITY_TIMEZONE } from '@/types/mentor';
import { slugify, uniqueSlug } from '@/lib/slugify';

/**
 * Derive a unique slug for a mentor from their full name, avoiding collisions
 * with any slug already taken by another mentor. Falls back to the id when the
 * name slugifies to an empty string (e.g. a name with no transliterable chars).
 */
function deriveMentorSlug(
  fullName: string,
  selfId: string,
  all: readonly MentorRecord[],
): string {
  const taken = all.filter((m) => m.id !== selfId && m.slug).map((m) => m.slug as string);
  const base = slugify(fullName) || selfId;
  return uniqueSlug(base, taken);
}

/**
 * One-time, idempotent backfill: assign slugs to any mentors missing one and
 * return the resulting list. Only writes when at least one mentor lacks a slug,
 * so steady-state reads stay write-free. Safe to call on every read.
 */
async function backfillMentorSlugs(mentors: MentorRecord[]): Promise<MentorRecord[]> {
  if (!mentors.some((m) => !m.slug)) return mentors;
  return db.update<MentorRecord[]>((d) => {
    for (const m of d.mentors) {
      if (!m.slug) m.slug = deriveMentorSlug(m.fullName, m.id, d.mentors);
    }
    return d.mentors;
  });
}

export async function listMentors(): Promise<MentorRecord[]> {
  const data = await db.read();
  const mentors = await backfillMentorSlugs(data.mentors ?? []);
  return [...mentors].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findMentorById(id: string): Promise<MentorRecord | null> {
  const data = await db.read();
  return (data.mentors ?? []).find((m) => m.id === id) ?? null;
}

/**
 * Resolve a mentor by slug OR id (slug takes priority). Powers the public
 * profile route so pre-slug mentors remain reachable via their id.
 */
export async function findMentorBySlugOrId(slugOrId: string): Promise<MentorRecord | null> {
  const data = await db.read();
  const mentors = data.mentors ?? [];
  return (
    mentors.find((m) => m.slug === slugOrId) ??
    mentors.find((m) => m.id === slugOrId) ??
    null
  );
}

export async function createMentor(input: CreateMentorInput): Promise<MentorRecord> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const fullName = input.fullName.trim();
  return db.update<MentorRecord>((d) => {
    const record: MentorRecord = {
      id,
      fullName,
      position: input.position.trim(),
      imageUrl: input.imageUrl.trim(),
      slug: deriveMentorSlug(fullName, id, d.mentors),
      bio: input.bio?.trim() || null,
      linkedinUrl: input.linkedinUrl?.trim() || null,
      email: input.email?.trim() || null,
      consultationFee: input.consultationFee ?? 0,
      createdAt: now,
    };
    d.mentors.push(record);
    return record;
  });
}

export type UpdateMentorResult =
  | { ok: true; mentor: MentorRecord }
  | { ok: false; reason: 'NOT_FOUND' };

export async function updateMentor(
  id: string,
  patch: UpdateMentorInput,
): Promise<UpdateMentorResult> {
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    if (patch.fullName !== undefined) m.fullName = patch.fullName.trim();
    // Generate a slug only if the mentor still lacks one — keep existing slugs
    // stable so shared profile URLs never break after an edit.
    if (!m.slug) m.slug = deriveMentorSlug(m.fullName, m.id, d.mentors);
    if (patch.position !== undefined) m.position = patch.position.trim();
    if (patch.imageUrl !== undefined) m.imageUrl = patch.imageUrl.trim();
    if (patch.bio !== undefined) m.bio = patch.bio?.trim() || null;
    if (patch.linkedinUrl !== undefined) m.linkedinUrl = patch.linkedinUrl?.trim() || null;
    if (patch.email !== undefined) m.email = patch.email?.trim() || null;
    if (patch.consultationFee !== undefined) m.consultationFee = patch.consultationFee;
    return { ok: true, mentor: m };
  });
}

/**
 * Set the consultant's instant-book meeting defaults (self-service). When a
 * usable default exists, paid bookings land READY immediately; otherwise
 * AWAITING_LINK until a link is supplied.
 */
export async function updateMentorMeetingDefaults(
  id: string,
  patch: { defaultMeetingMode?: 'ONLINE' | 'OFFLINE'; defaultMeetingLink?: string | null },
): Promise<UpdateMentorResult> {
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    if (patch.defaultMeetingMode !== undefined) m.defaultMeetingMode = patch.defaultMeetingMode;
    if (patch.defaultMeetingLink !== undefined) m.defaultMeetingLink = patch.defaultMeetingLink?.trim() || null;
    return { ok: true, mentor: m };
  });
}

/**
 * Replace a mentor's availability (weekly template + blocked dates + timezone).
 * Normalizes the payload: drops weekday entries with no slots, de-dupes and
 * sorts blocked dates, and defaults the timezone. Validation (end > start,
 * overlaps, valid timezone) is enforced upstream by `mentorAvailabilitySchema`.
 */
export async function updateMentorAvailability(
  id: string,
  patch: MentorAvailabilityPatch,
): Promise<UpdateMentorResult> {
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    m.weeklyAvailability = patch.weeklyAvailability
      .filter((day) => day.slots.length > 0)
      .map((day) => ({
        weekday: day.weekday,
        slots: day.slots.map((s) => ({ start: s.start, end: s.end })),
      }));
    m.blockedDates = Array.from(new Set(patch.blockedDates)).sort();
    m.availabilityTimezone = patch.availabilityTimezone?.trim() || DEFAULT_AVAILABILITY_TIMEZONE;
    return { ok: true, mentor: m };
  });
}

export type DeleteMentorResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' };

export async function deleteMentor(id: string): Promise<DeleteMentorResult> {
  return db.update<DeleteMentorResult>((d) => {
    const before = d.mentors.length;
    d.mentors = d.mentors.filter((m) => m.id !== id);
    if (d.mentors.length === before) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true };
  });
}
