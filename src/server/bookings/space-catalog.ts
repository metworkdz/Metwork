/**
 * Space catalog — DB-only.
 *
 * Returns only real spaces created by incubators or the admin.
 * Demo/seed data is never shown; the public page will be empty until a real
 * incubator publishes a space.
 */
import { db } from '@/server/db/store';
import type { Space } from '@/types/domain';

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const DEFAULT_OPENING_TIME = '09:00';
const DEFAULT_CLOSING_TIME = '18:00';

/** Map a DB SpaceRecord → the public Space domain type. */
function fromRecord(r: import('@/server/db/store').SpaceRecord): Space {
  return {
    id:                     r.id,
    incubatorId:            r.incubatorId,
    incubatorName:          r.incubatorName,
    name:                   r.name,
    description:            r.description,
    category:               r.category,
    city:                   r.city,
    imageUrl:               r.imageUrl,
    imageUrls:              r.imageUrls?.length ? r.imageUrls : (r.imageUrl ? [r.imageUrl] : []),
    pricePerHour:           r.pricePerHour,
    pricePerDay:            r.pricePerDay,
    pricePerMonth:          r.pricePerMonth,
    cashPricePerHour:       r.cashPricePerHour ?? null,
    cashPricePerDay:        r.cashPricePerDay ?? null,
    cashPricePerMonth:      r.cashPricePerMonth ?? null,
    capacity:               r.capacity,
    amenities:              r.amenities,
    rating:                 null,
    reviewCount:            0,
    acceptedPaymentMethods: r.acceptedPaymentMethods,
    cashDepositType:        r.cashDepositType,
    cashDepositValue:       r.cashDepositValue,
    workingDays:  r.workingDays  ?? DEFAULT_WORKING_DAYS,
    openingTime:  r.openingTime  ?? DEFAULT_OPENING_TIME,
    closingTime:  r.closingTime  ?? DEFAULT_CLOSING_TIME,
  };
}

/** List all active spaces whose owning incubator is also ACTIVE (no demo fallback). */
export async function listSpaces(): Promise<Space[]> {
  const data = await db.read();
  // Pre-compute the set of approved (ACTIVE) incubator IDs so we can filter
  // out spaces belonging to PENDING / INACTIVE / SUSPENDED incubators.
  const activeIncIds = new Set(
    (data.incubators ?? [])
      .filter((i) => i.status === 'ACTIVE')
      .map((i) => i.id),
  );
  return (data.spaces ?? [])
    .filter((s) => s.isActive && activeIncIds.has(s.incubatorId))
    .map(fromRecord);
}

/** Find a single active space by ID from the DB. */
export async function findSpaceById(id: string): Promise<Space | null> {
  const data = await db.read();
  const dbSpace = (data.spaces ?? []).find((s) => s.id === id && s.isActive);
  if (!dbSpace) return null;
  const inc = (data.incubators ?? []).find((i) => i.id === dbSpace.incubatorId);
  if (!inc || inc.status !== 'ACTIVE') return null;
  return fromRecord(dbSpace);
}

/** List all spaces (active and inactive) owned by a specific incubator. */
export async function listSpacesByIncubator(incubatorId: string): Promise<Space[]> {
  const data = await db.read();
  return (data.spaces ?? [])
    .filter((s) => s.incubatorId === incubatorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(fromRecord);
}
