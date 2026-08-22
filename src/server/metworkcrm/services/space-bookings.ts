/**
 * METWORK OS CRM — Space bookings service (product spec §4.13).
 *
 * Strict boundary, repeated from the schema/spec because it's easy to forget
 * mid-refactor: this is a MANUAL TEAM LOG. It never reads real availability,
 * never writes a platform BookingRecord/DeskBookingRecord, never holds a
 * slot. `platformSpaceId` is a free-text reference label, not wired to
 * anything — the canonical availability engine
 * (`src/server/spaces/availability.ts`) is untouched and remains the only
 * source of truth for real bookings.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmContacts, crmOpportunities, crmOrganizations, crmSpaceBookings, crmTasks } from '../db/schema';
import type { InternalUser } from '../db/schema';
import type { SpaceBookingInput } from '../validation/space-bookings';
import { redactMoney } from '../auth/guards';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkSpaceBookingDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['quotedAmount', 'finalAmount'] as const;

/** `RES-YYYYMMDD-XXXX` — collision is astronomically unlikely but the unique index is the real guarantee; one retry covers it. */
async function generateReference(db: ReturnType<typeof getCrmDb>): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
    const candidate = `RES-${datePart}-${suffix}`;
    const existing = await db
      .select({ id: crmSpaceBookings.id })
      .from(crmSpaceBookings)
      .where(eq(crmSpaceBookings.reference, candidate));
    if (existing.length === 0) return candidate;
  }
  throw new CrmServiceError(500, 'CRM_INTERNAL_ERROR', 'Impossible de générer une référence unique.');
}

export interface SpaceBookingListFilters {
  q?: string;
  spaceType?: string;
  status?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}

export async function listSpaceBookings(filters: SpaceBookingListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.spaceType ? eq(crmSpaceBookings.spaceType, filters.spaceType as never) : undefined,
    filters.status ? eq(crmSpaceBookings.status, filters.status as never) : undefined,
    filters.organizationId ? eq(crmSpaceBookings.organizationId, filters.organizationId) : undefined,
    filters.q
      ? sql`(${crmSpaceBookings.spaceLabel} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE OR ${crmSpaceBookings.reference} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)`
      : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmSpaceBookings)
      .where(where)
      .orderBy(desc(crmSpaceBookings.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmSpaceBookings).where(where),
  ]);

  return { rows: rows.map((r) => redactMoney(user, r, MONEY_FIELDS)), total: Number(totalRows[0]?.n ?? 0) };
}

export async function getSpaceBookingDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const booking = (await db.select().from(crmSpaceBookings).where(eq(crmSpaceBookings.id, id)))[0];
  if (!booking) throw new CrmNotFoundError('Réservation');

  const [organization, contact, opportunity, tasks, documents] = await Promise.all([
    booking.organizationId
      ? (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, booking.organizationId)))[0] ?? null
      : null,
    booking.contactId ? (await db.select().from(crmContacts).where(eq(crmContacts.id, booking.contactId)))[0] ?? null : null,
    booking.opportunityId
      ? (await db.select().from(crmOpportunities).where(eq(crmOpportunities.id, booking.opportunityId)))[0] ?? null
      : null,
    db.select().from(crmTasks).where(eq(crmTasks.bookingId, id)).orderBy(desc(crmTasks.createdAt)),
    listDocumentsFor('SPACE_BOOKING', id),
  ]);

  return { booking: redactMoney(user, booking, MONEY_FIELDS), organization, contact, opportunity, tasks, documents };
}

export async function createSpaceBooking(input: SpaceBookingInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const reference = await generateReference(db);

  await db.insert(crmSpaceBookings).values({
    id,
    reference,
    spaceLabel: input.spaceLabel,
    spaceType: input.spaceType,
    organizationId: input.organizationId ?? null,
    contactId: input.contactId ?? null,
    opportunityId: input.opportunityId ?? null,
    startAt: input.startAt ?? null,
    endAt: input.endAt ?? null,
    attendees: input.attendees,
    quotedAmount: input.quotedAmount,
    finalAmount: input.finalAmount,
    status: input.status,
    notes: input.notes ?? null,
    ownerId: input.ownerId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmSpaceBookings).where(eq(crmSpaceBookings.id, id)))[0]!;
}

export async function updateSpaceBooking(id: string, input: Partial<SpaceBookingInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmSpaceBookings).where(eq(crmSpaceBookings.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Réservation');

  const mergedOrgId = 'organizationId' in input ? (input.organizationId ?? null) : existing.organizationId;
  const mergedContactId = 'contactId' in input ? (input.contactId ?? null) : existing.contactId;
  if (!mergedOrgId && !mergedContactId) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez cette réservation à une organisation ou un contact.');
  }

  await db.update(crmSpaceBookings).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(crmSpaceBookings.id, id));
  return (await db.select().from(crmSpaceBookings).where(eq(crmSpaceBookings.id, id)))[0]!;
}

export async function deleteSpaceBooking(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmSpaceBookings.id }).from(crmSpaceBookings).where(eq(crmSpaceBookings.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Réservation');

  const guard = await checkSpaceBookingDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('cette réservation', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmSpaceBookings).where(eq(crmSpaceBookings.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer cette réservation — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('SPACE_BOOKING', id);
}
