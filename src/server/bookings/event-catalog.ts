/**
 * Event catalog — DB-only.
 *
 * Returns only real events created by incubators or the admin.
 * Demo/seed data is never shown.
 */
import { db } from '@/server/db/store';
import type { Event as PlatformEvent } from '@/types/domain';

function fromRecord(r: import('@/server/db/store').EventRecord): PlatformEvent {
  return {
    id:                     r.id,
    incubatorId:            r.incubatorId,
    incubatorName:          r.incubatorName,
    title:                  r.title,
    description:            r.description,
    city:                   r.city,
    imageUrl:               r.imageUrl,
    price:                  r.price,
    isOnline:               r.isOnline,
    capacity:               r.capacity,
    attendeeCount:          0, // computed live by the caller
    eventDate:              r.eventDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    slug:                   r.slug ?? null,
  };
}

/** List all active events from the DB (no demo fallback). */
export async function listEvents(): Promise<PlatformEvent[]> {
  const data = await db.read();
  return (data.events ?? []).filter((e) => e.isActive).map(fromRecord);
}

/** Find a single active event by ID. */
export async function findEventById(id: string): Promise<PlatformEvent | null> {
  const data = await db.read();
  const dbEv = (data.events ?? []).find((e) => e.id === id && e.isActive);
  return dbEv ? fromRecord(dbEv) : null;
}

/** List all events (active and inactive) owned by a specific incubator. */
export async function listEventsByIncubator(incubatorId: string): Promise<PlatformEvent[]> {
  const data = await db.read();
  return (data.events ?? [])
    .filter((e) => e.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
