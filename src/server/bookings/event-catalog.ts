import { db } from '@/server/db/store';
import type { Event as PlatformEvent } from '@/types/domain';
import type { IncubatorEventRecord, IncubatorRecord } from '@/server/db/store';

function dbEventToEvent(e: IncubatorEventRecord, incubator: IncubatorRecord, attendeeCount: number): PlatformEvent {
  return {
    id: e.id,
    incubatorId: e.incubatorId,
    incubatorName: incubator.name,
    title: e.title,
    description: e.description,
    city: e.city,
    imageUrl: e.imageUrl,
    price: e.price,
    isOnline: e.isOnline,
    capacity: e.capacity,
    attendeeCount,
    eventDate: e.eventDate,
  };
}

export async function findEventById(id: string): Promise<PlatformEvent | null> {
  const data = await db.read();
  const dbEvent = (data.incubatorEvents ?? []).find((e) => e.id === id);
  if (!dbEvent) return null;
  const incubator = data.incubators.find((i) => i.id === dbEvent.incubatorId);
  if (!incubator) return null;
  const attendeeCount = data.bookings.filter(
    (b) =>
      b.itemKind === 'EVENT' &&
      b.itemId === id &&
      b.status !== 'CANCELLED' &&
      b.status !== 'REFUNDED',
  ).length;
  return dbEventToEvent(dbEvent, incubator, attendeeCount);
}

export async function listEvents(filters?: { incubatorId?: string }): Promise<PlatformEvent[]> {
  const data = await db.read();
  return (data.incubatorEvents ?? [])
    .filter((e) => e.status === 'PUBLISHED')
    .filter((e) => !filters?.incubatorId || e.incubatorId === filters.incubatorId)
    .map((e) => {
      const incubator = data.incubators.find((i) => i.id === e.incubatorId);
      if (!incubator) return null;
      const attendeeCount = data.bookings.filter(
        (b) =>
          b.itemKind === 'EVENT' &&
          b.itemId === e.id &&
          b.status !== 'CANCELLED' &&
          b.status !== 'REFUNDED',
      ).length;
      return dbEventToEvent(e, incubator, attendeeCount);
    })
    .filter((e): e is PlatformEvent => e !== null);
}
