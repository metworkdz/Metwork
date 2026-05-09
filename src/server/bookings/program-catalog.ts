/**
 * Program catalog. DB-first with demo fallback.
 * See `space-catalog.ts` for the same pattern.
 */
import { db, type IncubatorProgramRecord, type IncubatorRecord } from '@/server/db/store';
import { demoPublicPrograms } from '@/lib/demo-data';
import type { Program } from '@/types/domain';

function dbProgramToProgram(p: IncubatorProgramRecord, incubator: IncubatorRecord): Program {
  return {
    id: p.id,
    incubatorId: p.incubatorId,
    incubatorName: incubator.name,
    title: p.title,
    description: p.description,
    type: p.type,
    city: p.city,
    imageUrl: p.imageUrl,
    price: p.price,
    seatsTotal: p.seatsTotal,
    seatsTaken: 0, // computed below when listing
    deadline: p.deadline,
    startDate: p.startDate,
    endDate: p.endDate,
  };
}

function fromRecord(r: import('@/server/db/store').ProgramRecord): Program {
  return {
    id: r.id,
    incubatorId: r.incubatorId,
    incubatorName: r.incubatorName,
    title: r.title,
    description: r.description,
    type: r.type,
    city: r.city,
    imageUrl: r.imageUrl,
    price: r.price,
    seatsTotal: r.seatsTotal,
    seatsTaken: 0, // computed live by the service
    deadline: r.deadline,
    startDate: r.startDate,
    endDate: r.endDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
  };
}

function withDefaults(p: Omit<Program, 'acceptedPaymentMethods'>): Program {
  return { ...p, acceptedPaymentMethods: ['ONLINE', 'CASH'] };
}

export async function findProgramById(id: string): Promise<Program | null> {
  const data = await db.read();
  const dbProg = (data.programs ?? []).find((p) => p.id === id && p.isActive);
  if (dbProg) return fromRecord(dbProg);
  const demo = (demoPublicPrograms as Omit<Program, 'acceptedPaymentMethods'>[]).find((p) => p.id === id);
  return demo ? withDefaults(demo) : null;
}

export async function listPrograms(): Promise<Program[]> {
  const data = await db.read();
  const dbProgs = (data.programs ?? []).filter((p) => p.isActive).map(fromRecord);
  const dbIncubatorIds = new Set(dbProgs.map((p) => p.incubatorId));
  const demoProgs = (demoPublicPrograms as Omit<Program, 'acceptedPaymentMethods'>[])
    .filter((p) => !dbIncubatorIds.has(p.incubatorId))
    .map(withDefaults);
  return [...dbProgs, ...demoProgs];
}

export async function listProgramsByIncubator(incubatorId: string): Promise<Program[]> {
  const data = await db.read();
  return (data.programs ?? [])
    .filter((p) => p.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
