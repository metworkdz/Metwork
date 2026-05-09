/**
 * Event catalog. DB-first with demo fallback.
 * See `space-catalog.ts` for the same pattern.
 */
import { db, type IncubatorEventRecord, type IncubatorRecord } from '@/server/db/store';
import { demoPublicEvents } from '@/lib/demo-data';
import type { Event as PlatformEvent } from '@/types/domain';

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

function fromRecord(r: import('@/server/db/store').EventRecord): PlatformEvent {
  return {
    id: r.id,
    incubatorId: r.incubatorId,
    incubatorName: r.incubatorName,
    title: r.title,
    description: r.description,
    city: r.city,
    imageUrl: r.imageUrl,
    price: r.price,
    isOnline: r.isOnline,
    capacity: r.capacity,
    attendeeCount: 0, // computed live by the service
    eventDate: r.eventDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
  };
}

function withDefaults(e: Omit<PlatformEvent, 'acceptedPaymentMethods'>): PlatformEvent {
  return { ...e, acceptedPaymentMethods: ['ONLINE', 'CASH'] };
}

export async function findEventById(id: string): Promise<PlatformEvent | null> {
  const data = await db.read();
  const dbEv = (data.events ?? []).find((e) => e.id === id && e.isActive);
  if (dbEv) return fromRecord(dbEv);
  const demo = (demoPublicEvents as Omit<PlatformEvent, 'acceptedPaymentMethods'>[]).find((e) => e.id === id);
  return demo ? withDefaults(demo) : null;
}

export async function listEvents(): Promise<PlatformEvent[]> {
  const data = await db.read();
  const dbEvs = (data.events ?? []).filter((e) => e.isActive).map(fromRecord);
  const dbIncubatorIds = new Set(dbEvs.map((e) => e.incubatorId));
  const demoEvs = (demoPublicEvents as Omit<PlatformEvent, 'acceptedPaymentMethods'>[])
    .filter((e) => !dbIncubatorIds.has(e.incubatorId))
    .map(withDefaults);
  return [...dbEvs, ...demoEvs];
}

export async function listEventsByIncubator(incubatorId: string): Promise<PlatformEvent[]> {
  const data = await db.read();
  return (data.events ?? [])
    .filter((e) => e.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
