import { randomUUID } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import type { CreateMentorInput, UpdateMentorInput, MentorAvailabilityPatch } from './schemas';
import { DEFAULT_AVAILABILITY_TIMEZONE } from '@/types/mentor';
import { slugify, uniqueSlug } from '@/lib/slugify';
import { isMentorApproved, isMentorPubliclyListed } from '@/lib/mentor-approval';

/**
 * Derive a unique slug for a mentor from their full name, avoiding collisions
 * with any slug already taken by another mentor. Falls back to the id when the
 * name slugifies to an empty string (e.g. a name with no transliterable chars).
 */
/** Trim, drop empties, and de-dupe expertise tags. Undefined ⇒ []. */
function normalizeTopics(topics: string[] | undefined): string[] {
  if (!topics) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of topics) {
    const t = raw.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

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

/**
 * Canonical PUBLIC mentor list — the only list resolver public surfaces may
 * use. Shows ADMIN-sourced, APPROVED, publicly-listed mentors only:
 * self-signed-up consultants never appear here (even after approval — they
 * are reachable solely via their direct slug link). Legacy admin-added
 * mentors lack all three fields and are grandfathered as listed by
 * `isMentorPubliclyListed`, so nothing existing ever disappears.
 */
export async function listPublicMentors(): Promise<MentorRecord[]> {
  return (await listMentors()).filter(isMentorPubliclyListed);
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

/**
 * Public variant of `findMentorBySlugOrId` — resolves to null for
 * non-APPROVED consultants so pending/rejected self-signups 404 on the
 * public profile route instead of leaking.
 */
export async function findPublicMentorBySlugOrId(slugOrId: string): Promise<MentorRecord | null> {
  const mentor = await findMentorBySlugOrId(slugOrId);
  return mentor && isMentorApproved(mentor) ? mentor : null;
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
      phone: input.phone?.trim() || null,
      city: input.city?.trim() || null,
      consultationFee: input.consultationFee ?? 0,
      createdAt: now,
      updatedAt: now,
      minNoticeHours: input.minNoticeHours ?? null,
      bufferMinutes: input.bufferMinutes ?? null,
      topics: normalizeTopics(input.topics),
      ratePer30: input.ratePer30 ?? null,
      ratePer60: input.ratePer60 ?? null,
      freeIntroEnabled: input.freeIntroEnabled ?? null,
      source: 'ADMIN',
      approvalStatus: 'APPROVED',
      publiclyListed: true,
      avatarUrl: input.imageUrl.trim(),
    };
    d.mentors.push(record);
    return record;
  });
}

export type SelfSignupResult =
  | { ok: true; mentor: MentorRecord }
  | { ok: false; reason: 'EMAIL_IN_USE' };

/**
 * Consultant self-signup: create a PENDING mentor record. The email dedupe
 * happens atomically inside the same document update as the insert, so two
 * concurrent signups (or a race with an admin create) can never produce two
 * mentors sharing a login email — the OTP flow resolves mentors BY email.
 *
 * The record starts hidden: `approvalStatus: 'PENDING'` keeps it off every
 * public surface (list/profile/booking) until an admin approves it.
 */
export async function createSelfSignupMentor(input: {
  fullName: string;
  position: string;
  email: string;
  phone: string;
  city?: string | null;
  bio?: string | null;
  field?: string | null;
}): Promise<SelfSignupResult> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  return db.update<SelfSignupResult>((d) => {
    const taken = (d.mentors ?? []).some(
      (m) => (m.email ?? '').trim().toLowerCase() === email,
    );
    if (taken) return { ok: false, reason: 'EMAIL_IN_USE' };
    const record: MentorRecord = {
      id,
      fullName,
      position: input.position.trim(),
      // Placeholder avatar until the consultant uploads one from the portal.
      imageUrl: '/assets/profilelogogreen.png',
      avatarUrl: '/assets/profilelogogreen.png',
      slug: deriveMentorSlug(fullName, id, d.mentors),
      bio: input.bio?.trim() || null,
      linkedinUrl: null,
      email,
      phone: input.phone.trim(),
      phoneVerified: false,
      city: input.city?.trim() || null,
      field: input.field?.trim() || null,
      consultationFee: 0,
      createdAt: now,
      updatedAt: now,
      approvalStatus: 'PENDING',
      source: 'SELF',
      // Self-signups are NEVER on public list surfaces, even once approved —
      // clients reach them via the direct slug/booking link only.
      publiclyListed: false,
    };
    d.mentors.push(record);
    return { ok: true, mentor: record };
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
    if (patch.imageUrl !== undefined) {
      m.imageUrl = patch.imageUrl.trim();
      // avatarUrl is the canonical picture; keep it in lockstep so both the
      // legacy imageUrl readers and the avatar resolver see the same image.
      m.avatarUrl = m.imageUrl;
    }
    if (patch.bio !== undefined) m.bio = patch.bio?.trim() || null;
    if (patch.linkedinUrl !== undefined) m.linkedinUrl = patch.linkedinUrl?.trim() || null;
    if (patch.email !== undefined) m.email = patch.email?.trim() || null;
    if (patch.phone !== undefined) {
      const nextPhone = patch.phone?.trim() || null;
      // A different number invalidates the previous SMS verification.
      if (nextPhone !== (m.phone ?? null)) m.phoneVerified = false;
      m.phone = nextPhone;
    }
    if (patch.city !== undefined) m.city = patch.city?.trim() || null;
    if (patch.consultationFee !== undefined) m.consultationFee = patch.consultationFee;
    if (patch.minNoticeHours !== undefined) m.minNoticeHours = patch.minNoticeHours;
    if (patch.bufferMinutes !== undefined) m.bufferMinutes = patch.bufferMinutes;
    if (patch.topics !== undefined) m.topics = normalizeTopics(patch.topics);
    if (patch.ratePer30 !== undefined) m.ratePer30 = patch.ratePer30;
    if (patch.ratePer60 !== undefined) m.ratePer60 = patch.ratePer60;
    if (patch.freeIntroEnabled !== undefined) m.freeIntroEnabled = patch.freeIntroEnabled;
    m.updatedAt = new Date().toISOString();
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
  patch: {
    defaultMeetingMode?: 'ONLINE' | 'OFFLINE';
    defaultMeetingLink?: string | null;
    defaultMeetingAddress?: string | null;
    defaultMeetingMapsLink?: string | null;
  },
): Promise<UpdateMentorResult> {
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    if (patch.defaultMeetingMode !== undefined) m.defaultMeetingMode = patch.defaultMeetingMode;
    if (patch.defaultMeetingLink !== undefined) m.defaultMeetingLink = patch.defaultMeetingLink?.trim() || null;
    if (patch.defaultMeetingAddress !== undefined) m.defaultMeetingAddress = patch.defaultMeetingAddress?.trim() || null;
    if (patch.defaultMeetingMapsLink !== undefined) m.defaultMeetingMapsLink = patch.defaultMeetingMapsLink?.trim() || null;
    m.updatedAt = new Date().toISOString();
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
    m.updatedAt = new Date().toISOString();
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
