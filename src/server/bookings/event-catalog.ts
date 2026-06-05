/**
 * Event catalog — DB-only.
 *
 * Returns only real events created by incubators or the admin.
 * Demo/seed data is never shown.
 */
import { db, type EventRecord } from '@/server/db/store';
import { countAttendance } from '@/server/attendance';
import type { Event as PlatformEvent } from '@/types/domain';

function fromRecord(r: EventRecord, attendeeCount = 0): PlatformEvent {
  return {
    id:                     r.id,
    incubatorId:            r.incubatorId,
    incubatorName:          r.incubatorName,
    title:                  r.title,
    description:            r.description,
    city:                   r.city,
    imageUrl:               r.imageUrl,
    imageUrls:              r.imageUrls?.length ? r.imageUrls : (r.imageUrl ? [r.imageUrl] : []),
    price:                  r.price,
    isOnline:               r.isOnline,
    capacity:               r.capacity,
    attendeeCount,
    eventDate:              r.eventDate,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    cashDepositType:        r.cashDepositType,
    cashDepositValue:       r.cashDepositValue,
    slug:                   r.slug ?? null,
  };
}

/** List all active events whose owning incubator is ACTIVE (no demo fallback). */
export async function listEvents(): Promise<PlatformEvent[]> {
  const data = await db.read();
  const activeIncIds = new Set(
    (data.incubators ?? [])
      .filter((i) => i.status === 'ACTIVE')
      .map((i) => i.id),
  );
  return (data.events ?? [])
    .filter((e) => e.isActive && activeIncIds.has(e.incubatorId))
    .map((e) => fromRecord(e, countAttendance(data, 'EVENT', e.id)));
}

/** Find a single active event by ID. */
export async function findEventById(id: string): Promise<PlatformEvent | null> {
  const data = await db.read();
  const dbEv = (data.events ?? []).find((e) => e.id === id && e.isActive);
  if (!dbEv) return null;
  const inc = (data.incubators ?? []).find((i) => i.id === dbEv.incubatorId);
  if (!inc || inc.status !== 'ACTIVE') return null;
  return fromRecord(dbEv, countAttendance(data, 'EVENT', dbEv.id));
}

/** List all events (active and inactive) owned by a specific incubator. */
export async function listEventsByIncubator(incubatorId: string): Promise<PlatformEvent[]> {
  const data = await db.read();
  return (data.events ?? [])
    .filter((e) => e.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((e) => fromRecord(e, countAttendance(data, 'EVENT', e.id)));
}
