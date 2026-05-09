/**
 * Space catalog.
 *
 * Reads from the DB first (incubator-created spaces). Falls back to the
 * static demo inventory so the public Spaces page and booking validator
 * keep working even before any incubator has created a real space.
 *
 * When the DB has spaces for a given incubator, demo spaces from that
 * incubator are excluded so there's no double-listing.
 */
import { db } from '@/server/db/store';
import { demoPublicSpaces } from '@/lib/demo-data';
import type { Space } from '@/types/domain';

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Sat–Thu
const DEFAULT_OPENING_TIME = '09:00';
const DEFAULT_CLOSING_TIME = '18:00';

/** Map a DB SpaceRecord → the public Space domain type. */
function fromRecord(r: import('@/server/db/store').SpaceRecord): Space {
  return {
    id: r.id,
    incubatorId: r.incubatorId,
    incubatorName: r.incubatorName,
    name: r.name,
    description: r.description,
    category: r.category,
    city: r.city,
    imageUrl: r.imageUrl,
    pricePerHour: r.pricePerHour,
    pricePerDay: r.pricePerDay,
    pricePerMonth: r.pricePerMonth,
    capacity: r.capacity,
    amenities: r.amenities,
    rating: null,
    reviewCount: 0,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    workingDays:  r.workingDays  ?? DEFAULT_WORKING_DAYS,
    openingTime:  r.openingTime  ?? DEFAULT_OPENING_TIME,
    closingTime:  r.closingTime  ?? DEFAULT_CLOSING_TIME,
  };
}

/** Demo spaces don't store schedule fields — apply defaults. */
function withDefaults(s: Omit<Space, 'acceptedPaymentMethods' | 'workingDays' | 'openingTime' | 'closingTime'>): Space {
  return {
    ...s,
    acceptedPaymentMethods: ['ONLINE', 'CASH'],
    workingDays: DEFAULT_WORKING_DAYS,
    openingTime: DEFAULT_OPENING_TIME,
    closingTime: DEFAULT_CLOSING_TIME,
  };
}

export async function listSpaces(): Promise<Space[]> {
  const data = await db.read();
  const dbSpaces = (data.spaces ?? []).filter((s) => s.isActive).map(fromRecord);
  const dbIncubatorIds = new Set(dbSpaces.map((s) => s.incubatorId));
  // Exclude demo spaces for incubators that already have real DB spaces.
  const demoSpaces = (demoPublicSpaces as Omit<Space, 'acceptedPaymentMethods'>[])
    .filter((s) => !dbIncubatorIds.has(s.incubatorId))
    .map(withDefaults);
  return [...dbSpaces, ...demoSpaces];
}

export async function findSpaceById(id: string): Promise<Space | null> {
  const data = await db.read();
  const dbSpace = (data.spaces ?? []).find((s) => s.id === id && s.isActive);
  if (dbSpace) return fromRecord(dbSpace);
  const demo = (demoPublicSpaces as Omit<Space, 'acceptedPaymentMethods'>[]).find((s) => s.id === id);
  return demo ? withDefaults(demo) : null;
}

export async function listSpacesByIncubator(incubatorId: string): Promise<Space[]> {
  const data = await db.read();
  return (data.spaces ?? [])
    .filter((s) => s.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
