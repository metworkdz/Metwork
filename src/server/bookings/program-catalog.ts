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
    slug:                   r.slug ?? null,
  };
}

/** List all active programs whose owning incubator is ACTIVE (no demo fallback). */
export async function listPrograms(): Promise<Program[]> {
  const data = await db.read();
  const activeIncIds = new Set(
    (data.incubators ?? [])
      .filter((i) => i.status === 'ACTIVE')
      .map((i) => i.id),
  );
  return (data.programs ?? [])
    .filter((p) => p.isActive && activeIncIds.has(p.incubatorId))
    .map(fromRecord);
}

/** Find a single active program by ID. */
export async function findProgramById(id: string): Promise<Program | null> {
  const data = await db.read();
  const dbProg = (data.programs ?? []).find((p) => p.id === id && p.isActive);
  if (!dbProg) return null;
  const inc = (data.incubators ?? []).find((i) => i.id === dbProg.incubatorId);
  if (!inc || inc.status !== 'ACTIVE') return null;
  return fromRecord(dbProg);
}

/** List all programs (active and inactive) owned by a specific incubator. */
export async function listProgramsByIncubator(incubatorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
