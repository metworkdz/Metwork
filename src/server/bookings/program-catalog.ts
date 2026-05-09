import { db } from '@/server/db/store';
import type { Program } from '@/types/domain';
import type { IncubatorProgramRecord, IncubatorRecord } from '@/server/db/store';

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

export async function findProgramById(id: string): Promise<Program | null> {
  const data = await db.read();
  const dbProg = (data.incubatorPrograms ?? []).find((p) => p.id === id);
  if (dbProg) {
    const incubator = data.incubators.find((i) => i.id === dbProg.incubatorId);
    if (incubator) {
      const prog = dbProgramToProgram(dbProg, incubator);
      prog.seatsTaken = data.bookings.filter(
        (b) =>
          b.itemKind === 'PROGRAM' &&
          b.itemId === id &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED',
      ).length;
      return prog;
    }
  }
  return null;
}

export async function listPrograms(filters?: { incubatorId?: string }): Promise<Program[]> {
  const data = await db.read();

  const dbPrograms = (data.incubatorPrograms ?? [])
    .filter((p) => p.status === 'PUBLISHED')
    .filter((p) => !filters?.incubatorId || p.incubatorId === filters.incubatorId)
    .map((p) => {
      const incubator = data.incubators.find((i) => i.id === p.incubatorId);
      if (!incubator) return null;
      const prog = dbProgramToProgram(p, incubator);
      prog.seatsTaken = data.bookings.filter(
        (b) =>
          b.itemKind === 'PROGRAM' &&
          b.itemId === p.id &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED',
      ).length;
      return prog;
    })
    .filter((p): p is Program => p !== null);

  return dbPrograms;
}
