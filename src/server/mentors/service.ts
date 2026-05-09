import { randomUUID } from 'node:crypto';
import { db, type MentorRecord } from '@/server/db/store';
import type { CreateMentorInput, UpdateMentorInput } from './schemas';

export async function listMentors(): Promise<MentorRecord[]> {
  const data = await db.read();
  return [...(data.mentors ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function findMentorById(id: string): Promise<MentorRecord | null> {
  const data = await db.read();
  return (data.mentors ?? []).find((m) => m.id === id) ?? null;
}

export async function createMentor(input: CreateMentorInput): Promise<MentorRecord> {
  const now = new Date().toISOString();
  const record: MentorRecord = {
    id: randomUUID(),
    fullName: input.fullName.trim(),
    position: input.position.trim(),
    imageUrl: input.imageUrl.trim(),
    bio: input.bio?.trim() || null,
    linkedinUrl: input.linkedinUrl?.trim() || null,
    email: input.email?.trim() || null,
    consultationFee: input.consultationFee ?? 0,
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
  return db.update<UpdateMentorResult>((d) => {
    const m = d.mentors.find((x) => x.id === id);
    if (!m) return { ok: false, reason: 'NOT_FOUND' };
    if (patch.fullName !== undefined) m.fullName = patch.fullName.trim();
    if (patch.position !== undefined) m.position = patch.position.trim();
    if (patch.imageUrl !== undefined) m.imageUrl = patch.imageUrl.trim();
    if (patch.bio !== undefined) m.bio = patch.bio?.trim() || null;
    if (patch.linkedinUrl !== undefined) m.linkedinUrl = patch.linkedinUrl?.trim() || null;
    if (patch.email !== undefined) m.email = patch.email?.trim() || null;
    if (patch.consultationFee !== undefined) m.consultationFee = patch.consultationFee;
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
