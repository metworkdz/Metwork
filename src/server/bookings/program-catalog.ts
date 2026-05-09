/**
 * Program catalog — DB-only.
 *
 * Returns only real programs created by incubators or the admin.
 * Demo/seed data is never shown.
 */
import { db } from '@/server/db/store';
import type { Program } from '@/types/domain';

function fromRecord(r: import('@/server/db/store').ProgramRecord): Program {
  return {
    id:                     r.id,
    incubatorId:            r.incubatorId,
    incubatorName:          r.incubatorName,
    title:                  r.title,
    description:            r.description,
    type:                   r.type,
    city:                   r.city,
    imageUrl:               r.imageUrl,
    price:                  r.price,
    seatsTotal:             r.seatsTotal,
    seatsTaken:             0, // computed live by the caller
    deadline:               r.deadline,
    startDate:              r.startDate,
    endDate:                r.endDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
  };
}

/** List all active programs from the DB (no demo fallback). */
export async function listPrograms(): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? []).filter((p) => p.isActive).map(fromRecord);
}

/** Find a single active program by ID. */
export async function findProgramById(id: string): Promise<Program | null> {
  const data = await db.read();
  const dbProg = (data.programs ?? []).find((p) => p.id === id && p.isActive);
  return dbProg ? fromRecord(dbProg) : null;
}

/** List all programs (active and inactive) owned by a specific incubator. */
export async function listProgramsByIncubator(incubatorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
