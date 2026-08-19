/**
 * Program catalog — DB-only.
 *
 * Returns only real programs created by incubators or the admin.
 * Demo/seed data is never shown.
 */
import { db, type ProgramRecord } from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import {
  isProgramPubliclyListed,
  isProgramPubliclyReachable,
  programHostName,
} from '@/server/programs/ownership';
import type { Program } from '@/types/domain';

function fromRecord(r: ProgramRecord, seatsTaken = 0): Program {
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
    seatsTotal:             r.seatsTotal,
    seatsTaken,
    deadline:               r.deadline,
    startDate:              r.startDate,
    endDate:                r.endDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    cashDepositType:        r.cashDepositType,
    cashDepositValue:       r.cashDepositValue,
    slug:                   r.slug ?? null,
    isActive:               r.isActive,
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
    .map((p) => fromRecord(p, countAttendance(data, 'PROGRAM', p.id)));
}

/** List all programs (active and inactive) owned by a specific consultant. */
export async function listProgramsByMentor(mentorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.mentorId === mentorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => fromRecord(p, countAttendance(data, 'PROGRAM', p.id)));
}
