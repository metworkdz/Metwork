/**
 * METWORK OS CRM — Payments service (product spec §4.14).
 *
 * ADMIN-only, enforced at the ROUTE layer (`requireCrmApiAdmin`), not here —
 * this service is never reachable by a TEAM_MEMBER, so amounts are returned
 * as-is; no `redactMoney` call would make sense (there's no viewer to redact
 * for once you're this deep). If a future call site ever imports this
 * service from a non-admin-gated route, that route is the bug, not this file.
 *
 * "Ne remplace pas une comptabilité": no FK to wallets/transactions/invoices/
 * income anywhere in this file. `externalRef` stays free text.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmPayments } from '../db/schema';
import type { PaymentInput } from '../validation/payments';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkPaymentDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export interface PaymentListFilters {
  q?: string;
  status?: string;
  direction?: string;
  overdue?: boolean;
  limit: number;
  offset: number;
}

export async function listPayments(filters: PaymentListFilters) {
  const db = getCrmDb();
  const today = new Date().toISOString().slice(0, 10);
  const clauses = [
    filters.status ? eq(crmPayments.status, filters.status as never) : undefined,
    filters.direction ? eq(crmPayments.direction, filters.direction as never) : undefined,
    filters.overdue
      ? and(
          lt(crmPayments.dueDate, today),
          sql`${crmPayments.status} IN ('EN_ATTENTE', 'RELANCE_1', 'RELANCE_2')`,
        )
      : undefined,
    filters.q ? sql`(${crmPayments.label} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmPayments)
      .where(where)
      .orderBy(sql`${crmPayments.dueDate} IS NULL, ${crmPayments.dueDate} ASC`)
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmPayments).where(where),
  ]);

  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function getPaymentDetail(id: string) {
  const db = getCrmDb();
  const payment = (await db.select().from(crmPayments).where(eq(crmPayments.id, id)))[0];
  if (!payment) throw new CrmNotFoundError('Paiement');
  return payment;
}

export async function createPayment(input: PaymentInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmPayments).values({
    id,
    label: input.label,
    amount: input.amount,
    currency: input.currency,
    direction: input.direction,
    status: input.status,
    dueDate: input.dueDate ?? null,
    paidAt: input.status === 'PAYE' ? now : null,
    method: input.method ?? null,
    reminder1SentAt: input.status === 'RELANCE_1' || input.status === 'RELANCE_2' ? now : null,
    reminder2SentAt: input.status === 'RELANCE_2' ? now : null,
    opportunityId: input.opportunityId ?? null,
    spaceBookingId: input.spaceBookingId ?? null,
    programId: input.programId ?? null,
    organizationId: input.organizationId ?? null,
    contactId: input.contactId ?? null,
    partnershipId: input.partnershipId ?? null,
    oiProjectId: input.oiProjectId ?? null,
    externalRef: input.externalRef ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  return (await db.select().from(crmPayments).where(eq(crmPayments.id, id)))[0]!;
}

export async function updatePayment(id: string, input: Record<string, unknown>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmPayments).where(eq(crmPayments.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Paiement');

  const LINK_KEYS = [
    'opportunityId', 'spaceBookingId', 'programId', 'organizationId',
    'contactId', 'partnershipId', 'oiProjectId',
  ] as const;
  const mergedLink = (key: (typeof LINK_KEYS)[number]) =>
    key in input ? (input[key] as string | null) : (existing[key] as string | null);
  if (!LINK_KEYS.some((key) => mergedLink(key))) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Rattachez ce paiement à au moins un élément.');
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updatedAt: now };

  // Auto-stamp reminder/paid timestamps on a status transition — same
  // "the manual action IS the stamp" pattern as Opportunity's stageChangedAt.
  const nextStatus = input.status as string | undefined;
  if (nextStatus && nextStatus !== existing.status) {
    if (nextStatus === 'RELANCE_1' && !existing.reminder1SentAt) patch.reminder1SentAt = now;
    if (nextStatus === 'RELANCE_2' && !existing.reminder2SentAt) patch.reminder2SentAt = now;
    if (nextStatus === 'PAYE' && !existing.paidAt) patch.paidAt = now;
  }

  await db.update(crmPayments).set(patch).where(eq(crmPayments.id, id));
  return (await db.select().from(crmPayments).where(eq(crmPayments.id, id)))[0]!;
}

export async function deletePayment(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmPayments.id }).from(crmPayments).where(eq(crmPayments.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Paiement');

  const guard = await checkPaymentDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('ce paiement', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmPayments).where(eq(crmPayments.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer ce paiement — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('PAYMENT', id);
}
