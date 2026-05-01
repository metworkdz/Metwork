/**
 * Mentor service. Wraps the JSON store with a small CRUD surface and
 * handles first-run seeding from `demoMentors`.
 *
 * Seeding semantics:
 *   - The very first time the mentors collection is read while
 *     `meta.mentorsSeeded` is unset, the demo roster is inserted and
 *     the flag is flipped.
 *   - After that the data is owned by the admin: deleting all mentors
 *     keeps the collection empty (no re-seed loop).
 */
import { randomUUID } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import { demoMentors } from '@/lib/demo-data';
import type { CreateMentorInput, UpdateMentorInput } from './schemas';

async function ensureSeeded(): Promise<void> {
  const data = await db.read();
  if (data.meta?.mentorsSeeded) return;
  await db.update((d) => {
    if (d.meta?.mentorsSeeded) return; // double-check inside the lock
    if (!d.meta) d.meta = {};
    if (!Array.isArray(d.mentors)) d.mentors = [];
    if (d.mentors.length === 0) {
      // Map demo records to MentorRecord shape (identical here, but
      // explicit so the seed source can drift from the on-disk shape).
      d.mentors.push(
        ...demoMentors.map<MentorRecord>((m) => ({
          id: m.id,
          fullName: m.fullName,
          position: m.position,
          imageUrl: m.imageUrl,
          bio: m.bio,
          linkedinUrl: m.linkedinUrl,
          createdAt: m.createdAt,
        })),
      );
    }
    d.meta.mentorsSeeded = true;
  });
}

export async function listMentors(): Promise<MentorRecord[]> {
  await ensureSeeded();
  const data = await db.read();
  return [...data.mentors].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findMentorById(id: string): Promise<MentorRecord | null> {
  await ensureSeeded();
  const data = await db.read();
  return data.mentors.find((m) => m.id === id) ?? null;
}

export async function createMentor(input: CreateMentorInput): Promise<MentorRecord> {
  await ensureSeeded();
  const now = new Date().toISOString();
  const record: MentorRecord = {
    id: randomUUID(),
    fullName: input.fullName.trim(),
    position: input.position.trim(),
    imageUrl: input.imageUrl.trim(),
    bio: input.bio?.trim() || null,
    linkedinUrl: input.linkedinUrl?.trim() || null,
    createdAt: now,
  };
  await db.update((d) => {
    d.mentors.push(record);
  });
  return record;
}

export type UpdateMentorResult =
  | { ok: true; mentor: MentorRecord }
  | { ok: false; reason: 'NOT_FOUND' };

export async function updateMentor(
  id: string,
  patch: UpdateMentorInput,
): Promise<UpdateMentorResult> {
  await ensureSeeded();
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    if (patch.fullName !== undefined) m.fullName = patch.fullName.trim();
    if (patch.position !== undefined) m.position = patch.position.trim();
    if (patch.imageUrl !== undefined) m.imageUrl = patch.imageUrl.trim();
    if (patch.bio !== undefined) m.bio = patch.bio?.trim() || null;
    if (patch.linkedinUrl !== undefined) m.linkedinUrl = patch.linkedinUrl?.trim() || null;
    return { ok: true, mentor: m };
  });
}

export type DeleteMentorResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' };

export async function deleteMentor(id: string): Promise<DeleteMentorResult> {
  await ensureSeeded();
  return db.update<DeleteMentorResult>((d) => {
    const before = d.mentors.length;
    d.mentors = d.mentors.filter((m) => m.id !== id);
    if (d.mentors.length === before) return { ok: false, reason: 'NOT_FOUND' };
    return { ok: true };
  });
}
