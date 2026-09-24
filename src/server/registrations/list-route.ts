/**
 * Shared HTTP handler for "list the registrants of one listing".
 *
 * The incubator dashboard and the consultant portal show the same table, so
 * they have to be answered by the same contract: the same query parameters,
 * the same envelope, the same search, filter and paging behaviour. They were
 * not — the consultant route returned an unpaged `{ registrations, total }`
 * with no field definitions and no filters, so the shared table could not read
 * it at all.
 *
 * Only the owner differs, and the route files resolve that before calling in.
 *
 * `?view=abandoned` answers a different question on the same endpoint: who
 * filled in the form and never finished paying. Same owner scoping, same
 * shape of request, so the client needs no second contract.
 */
import type { NextRequest } from 'next/server';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';
import { listRegistrations, type OwnerScope } from '@/server/registrations/service';
import { listAbandonedCheckouts } from '@/server/registrations/abandoned-checkouts';
import { buildAnswerSummary } from '@/server/registrations/answer-summary';
import { programOwnedBy } from '@/server/certificates/service';

type StoreData = Awaited<ReturnType<typeof db.read>>;

/**
 * Does this owner own the listing? The registrations are owner-scoped row by
 * row, but the form's questions are not — so without this, any host could
 * read another host's application questions by trying listing ids.
 */
function ownsListing(
  data: StoreData,
  entityType: 'PROGRAM' | 'EVENT',
  entityId: string,
  owner: OwnerScope,
): boolean {
  if (entityType === 'PROGRAM') {
    const program = (data.programs ?? []).find((p) => p.id === entityId);
    return Boolean(program && programOwnedBy(program, owner));
  }
  // Events are incubator-only.
  const event = (data.events ?? []).find((e) => e.id === entityId);
  return Boolean(event && owner.kind === 'INCUBATOR' && event.incubatorId === owner.incubatorId);
}

export async function handleListRegistrations(req: NextRequest, owner: OwnerScope) {
  const { searchParams } = new URL(req.url);
  // A consultant only ever owns programs, but accepting the parameter keeps one
  // request shape across both surfaces.
  const entityType = (searchParams.get('entityType') ?? 'PROGRAM') as 'PROGRAM' | 'EVENT';
  const entityId = searchParams.get('entityId');
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '20')));
  const q = (searchParams.get('q') ?? '').trim().toLowerCase();
  const statusFilter = searchParams.get('status');

  if (!['PROGRAM', 'EVENT'].includes(entityType)) {
    return jsonError(400, 'MISSING_PARAM', 'entityType must be PROGRAM or EVENT');
  }
  if (!entityId) return jsonError(400, 'MISSING_PARAM', 'entityId is required');

  // The people who started paying and stopped. Everything about them was
  // already stored on the dead checkout intent; this only reads it back.
  if (searchParams.get('view') === 'abandoned') {
    const items = await listAbandonedCheckouts(entityType, entityId, owner);
    const data = await db.read();
    const formFields = ownsListing(data, entityType, entityId, owner)
      ? (data.registrationFormFields ?? [])
          .filter((f) => f.entityType === entityType && f.entityId === entityId)
          .sort((a, b) => a.order - b.order)
      : [];
    return json({ items, formFields, total: items.length });
  }

  // `listRegistrations` is already owner-scoped, so a listing belonging to
  // someone else simply comes back empty rather than leaking its registrants.
  let registrations = await listRegistrations(entityType, entityId, owner);

  // `?view=summary`: how the confirmed participants answered each
  // multiple-choice question. Same owner scoping — someone else's listing
  // summarises nobody.
  if (searchParams.get('view') === 'summary') {
    const data = await db.read();
    if (!ownsListing(data, entityType, entityId, owner)) return json(buildAnswerSummary([], []));
    const fields = (data.registrationFormFields ?? [])
      .filter((f) => f.entityType === entityType && f.entityId === entityId);
    return json(buildAnswerSummary(fields, registrations));
  }

  // The field definitions travel with the rows so the client can label answers.
  const data = await db.read();
  const formFields = ownsListing(data, entityType, entityId, owner)
    ? (data.registrationFormFields ?? [])
        .filter((f) => f.entityType === entityType && f.entityId === entityId)
        .sort((a, b) => a.order - b.order)
    : [];

  if (q) {
    registrations = registrations.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.phone.includes(q),
    );
  }
  if (statusFilter && ['CONFIRMED', 'WAITLISTED', 'CANCELLED'].includes(statusFilter)) {
    registrations = registrations.filter((r) => r.status === statusFilter);
  }

  const total = registrations.length;
  const items = registrations.slice((page - 1) * pageSize, page * pageSize);

  return json({
    items,
    formFields,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}
