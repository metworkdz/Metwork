import { db } from '@/server/db/store';
import type { Space } from '@/types/domain';
import type { IncubatorSpaceRecord, IncubatorRecord } from '@/server/db/store';

function dbSpaceToSpace(s: IncubatorSpaceRecord, incubator: IncubatorRecord): Space {
  return {
    id: s.id,
    incubatorId: s.incubatorId,
    incubatorName: incubator.name,
    name: s.name,
    description: s.description,
    category: s.category,
    city: s.city,
    imageUrl: s.imageUrl,
    pricePerHour: s.pricePerHour,
    pricePerDay: s.pricePerDay,
    pricePerMonth: s.pricePerMonth,
    capacity: s.capacity,
    amenities: s.amenities,
    rating: null,
    reviewCount: 0,
  };
}

export async function findSpaceById(id: string): Promise<Space | null> {
  const data = await db.read();
  const dbSpace = (data.incubatorSpaces ?? []).find((s) => s.id === id);
  if (!dbSpace) return null;
  const incubator = data.incubators.find((i) => i.id === dbSpace.incubatorId);
  return incubator ? dbSpaceToSpace(dbSpace, incubator) : null;
}

export async function listSpaces(filters?: { incubatorId?: string }): Promise<Space[]> {
  const data = await db.read();
  return (data.incubatorSpaces ?? [])
    .filter((s) => s.status === 'ACTIVE')
    .filter((s) => !filters?.incubatorId || s.incubatorId === filters.incubatorId)
    .map((s) => {
      const incubator = data.incubators.find((i) => i.id === s.incubatorId);
      return incubator ? dbSpaceToSpace(s, incubator) : null;
    })
    .filter((s): s is Space => s !== null);
}
