/**
 * Program catalog — DB-only.
 *
 * Returns only real programs created by incubators or the admin.
 * Demo/seed data is never shown.
 */
import { db, type ProgramRecord } from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import { isUnlimited } from '@/lib/seat-limit';
import {
  isProgramPubliclyListed,
  isProgramPubliclyReachable,
  programHostName,
  programVisibility,
} from '@/server/programs/ownership';
import type { Program } from '@/types/domain';
import { programDatesTbc } from '@/lib/program-dates';

/**
 * Who the copy is for. PUBLIC is the default on purpose: a program with no seat
 * limit must not tell anyone how many people enrolled, so forgetting to say
 * "OWNER" fails toward privacy. Only the host's own dashboard asks for OWNER.
 */
type Audience = 'PUBLIC' | 'OWNER';

function fromRecord(r: ProgramRecord, seatsTaken = 0, audience: Audience = 'PUBLIC'): Program {
  const hideCounts = isUnlimited(r) && audience === 'PUBLIC';
  return {
    id:                     r.id,
    incubatorId:            r.incubatorId,
    incubatorName:          r.incubatorName,
    mentorId:               r.mentorId ?? null,
    mentorName:             r.mentorName ?? null,
    hostName:               programHostName(r),
    title:                  r.title,
    description:            r.description,
    type:                   r.type,
    city:                   r.city,
    imageUrl:               r.imageUrl,
    imageUrls:              r.imageUrls?.length ? r.imageUrls : (r.imageUrl ? [r.imageUrl] : []),
    price:                  r.price,
    onlinePrice:            r.onlinePrice ?? null,
    cashPrice:              r.cashPrice ?? null,
    seatsTotal:             hideCounts ? 0 : r.seatsTotal,
    seatsTaken:             hideCounts ? 0 : seatsTaken,
    ...(isUnlimited(r) ? { unlimitedCapacity: true } : {}),
    deadline:               r.deadline,
    startDate:              r.startDate,
    startTime:              r.startTime ?? null,
    endTime:                r.endTime ?? null,
    endDate:                r.endDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    cashDepositType:        r.cashDepositType,
    cashDepositValue:       r.cashDepositValue,
    slug:                   r.slug ?? null,
    isActive:               r.isActive,
    visibility:             programVisibility(r),
    datesTbc:               programDatesTbc(r),
    createdAt:              r.createdAt,
  };
}

/**
 * List all programs shown on public LIST surfaces (the /programs explorer).
 * Owner must be in good standing AND publicly listed — for consultant-owned
 * programs that mirrors the mentor list gate, so a self-signed-up consultant's
 * programs stay off the explorer unless an admin published them.
 */
export async function listPrograms(): Promise<Program[]> {
  const data = await db.read();
  const lookups = { incubators: data.incubators ?? [], mentors: data.mentors ?? [] };
  return (data.programs ?? [])
    .filter((p) => isProgramPubliclyListed(p, lookups))
    // Newest first: the store keeps insertion order, which put the oldest on top.
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .map((p) => fromRecord(p, countAttendance(data, 'PROGRAM', p.id)));
}

/**
 * Find a single program reachable by direct link. Looser than `listPrograms`:
 * an approved-but-unlisted consultant's program resolves here (direct link
 * works) while staying off the explorer — same rule mentors themselves follow.
 */
export async function findProgramById(id: string): Promise<Program | null> {
  const data = await db.read();
  const dbProg = (data.programs ?? []).find((p) => p.id === id);
  if (!dbProg) return null;
  const lookups = { incubators: data.incubators ?? [], mentors: data.mentors ?? [] };
  if (!isProgramPubliclyReachable(dbProg, lookups)) return null;
  return fromRecord(dbProg, countAttendance(data, 'PROGRAM', dbProg.id));
}

/** List all programs (active and inactive) owned by a specific incubator. */
export async function listProgramsByIncubator(incubatorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => fromRecord(p, countAttendance(data, 'PROGRAM', p.id), 'OWNER'));
}

/** List all programs (active and inactive) owned by a specific consultant. */
export async function listProgramsByMentor(mentorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.mentorId === mentorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => fromRecord(p, countAttendance(data, 'PROGRAM', p.id), 'OWNER'));
}
