/**
 * METWORK OS CRM — Programs & Events service.
 *
 * Three junctions, three different shapes on purpose (matches the schema):
 * participants are a real roster (status/attendance/satisfaction — the
 * heaviest), trainers are a short list with a `confirmed` flag (the pipeline's
 * "Trainer Confirmed" stage is about this flag, though the stage transition
 * itself is never hard-gated on it — a manual team call, same as every other
 * pipeline in this CRM), partners are the lightest (just a link + role).
 *
 * Payments panel here is intentionally narrow — see SESSION_LOG: read access
 * follows the same `redactMoney` posture as everywhere else, but *creating* a
 * payment is ADMIN-only at the route layer (dev rules: Payments is an
 * admin-only module), not re-implemented here.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContacts,
  crmExperts,
  crmOrganizations,
  crmPartnerships,
  crmPayments,
  crmProgramParticipants,
  crmProgramPartners,
  crmPrograms,
  crmProgramTrainers,
  crmTasks,
} from '../db/schema';
import type { InternalUser } from '../db/schema';
import type { ParticipantInput, PartnerInput, ProgramInput } from '../validation/programs';
import { redactMoney } from '../auth/guards';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkProgramDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';
import { runProgramChecklistAutomation } from './automations';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['price'] as const;
const PAYMENT_MONEY_FIELDS = ['amount'] as const;

export interface ProgramListFilters {
  q?: string;
  type?: string;
  stage?: string;
  limit: number;
  offset: number;
}

export async function listPrograms(filters: ProgramListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.type ? eq(crmPrograms.type, filters.type as never) : undefined,
    filters.stage ? eq(crmPrograms.stage, filters.stage as never) : undefined,
    filters.q ? sql`(${crmPrograms.title} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmPrograms)
      .where(where)
      .orderBy(desc(crmPrograms.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmPrograms).where(where),
  ]);

  return { rows: rows.map((r) => redactMoney(user, r, MONEY_FIELDS)), total: Number(totalRows[0]?.n ?? 0) };
}

export async function getProgramDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const program = (await db.select().from(crmPrograms).where(eq(crmPrograms.id, id)))[0];
  if (!program) throw new CrmNotFoundError('Programme');

  const [participants, trainers, partners, tasks, payments, documents] = await Promise.all([
    db
      .select({ participant: crmProgramParticipants, contact: crmContacts })
      .from(crmProgramParticipants)
      .leftJoin(crmContacts, eq(crmProgramParticipants.contactId, crmContacts.id))
      .where(eq(crmProgramParticipants.programId, id))
      .orderBy(desc(crmProgramParticipants.createdAt)),
    db
      .select({ trainer: crmProgramTrainers, expert: crmExperts })
      .from(crmProgramTrainers)
      .leftJoin(crmExperts, eq(crmProgramTrainers.expertId, crmExperts.id))
      .where(eq(crmProgramTrainers.programId, id))
      .orderBy(asc(crmProgramTrainers.createdAt)),
    db
      .select({ partner: crmProgramPartners, partnership: crmPartnerships, organization: crmOrganizations })
      .from(crmProgramPartners)
      .leftJoin(crmPartnerships, eq(crmProgramPartners.partnershipId, crmPartnerships.id))
      .leftJoin(crmOrganizations, eq(crmProgramPartners.organizationId, crmOrganizations.id))
      .where(eq(crmProgramPartners.programId, id))
      .orderBy(asc(crmProgramPartners.createdAt)),
    db.select().from(crmTasks).where(eq(crmTasks.programId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmPayments).where(eq(crmPayments.programId, id)).orderBy(desc(crmPayments.createdAt)),
    listDocumentsFor('PROGRAM', id),
  ]);

  return {
    program: redactMoney(user, program, MONEY_FIELDS),
    participants: participants.map((r) => ({
      ...r.participant,
      contactName: r.contact?.fullName ?? null,
      displayName: r.contact?.fullName ?? r.participant.fullName,
    })),
    trainers: trainers.map((r) => ({
      ...r.trainer,
      expertName: r.expert ? (r.expert.displayNameCache ?? r.expert.name) : null,
    })),
    partners: partners.map((r) => ({
      ...r.partner,
      displayName: r.partnership?.name ?? r.organization?.name ?? null,
    })),
    tasks,
    payments: payments.map((p) => redactMoney(user, p, PAYMENT_MONEY_FIELDS)),
    documents,
  };
}

export async function createProgram(input: ProgramInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmPrograms).values({
    id,
    title: input.title,
    type: input.type,
    stage: input.stage,
    stageChangedAt: now,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    city: input.city ?? null,
    venue: input.venue ?? null,
    capacity: input.capacity,
    price: input.price,
    description: input.description ?? null,
    ownerId: input.ownerId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  const created = (await db.select().from(crmPrograms).where(eq(crmPrograms.id, id)))[0]!;

  // Non-blocking automation (R-22/R-23, product spec §4.17) — runs AFTER the
  // insert above has committed; a failure here can never fail this request.
  await runProgramChecklistAutomation({ id: created.id, title: created.title, ownerId: created.ownerId });

  return created;
}

export async function updateProgram(id: string, input: Partial<ProgramInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmPrograms).where(eq(crmPrograms.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Programme');

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...input, updatedAt: now };
  if (input.stage && input.stage !== existing.stage) {
    patch.stageChangedAt = now;
  }

  await db.update(crmPrograms).set(patch).where(eq(crmPrograms.id, id));
  return (await db.select().from(crmPrograms).where(eq(crmPrograms.id, id)))[0]!;
}

export async function deleteProgram(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmPrograms.id }).from(crmPrograms).where(eq(crmPrograms.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Programme');

  const guard = await checkProgramDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('ce programme', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmPrograms).where(eq(crmPrograms.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer ce programme — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('PROGRAM', id);
}

/* ─────────────────────────── Participants ─────────────────────────── */

export async function addParticipant(programId: string, input: ParticipantInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  await db.insert(crmProgramParticipants).values({
    id: randomUUID(),
    programId,
    contactId: input.contactId ?? null,
    startupId: input.startupId ?? null,
    organizationId: input.organizationId ?? null,
    fullName: input.fullName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    status: input.status,
    attended: input.attended,
    satisfactionScore: input.satisfactionScore,
    amountDue: input.amountDue,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });
}

export async function updateParticipant(participantId: string, input: Record<string, unknown>) {
  const db = getCrmDb();
  const existing = (
    await db.select().from(crmProgramParticipants).where(eq(crmProgramParticipants.id, participantId))
  )[0];
  if (!existing) throw new CrmNotFoundError('Participant');

  const nextContactId = 'contactId' in input ? (input.contactId as string | null) : existing.contactId;
  const nextFullName = 'fullName' in input ? (input.fullName as string | null) : existing.fullName;
  if (!nextContactId && !nextFullName) {
    throw new CrmServiceError(422, 'CRM_VALIDATION_ERROR', 'Indiquez un contact existant ou un nom.');
  }

  await db
    .update(crmProgramParticipants)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(crmProgramParticipants.id, participantId));
}

export async function removeParticipant(participantId: string): Promise<void> {
  await getCrmDb().delete(crmProgramParticipants).where(eq(crmProgramParticipants.id, participantId));
}

/* ─────────────────────────── Trainers ─────────────────────────── */

export async function addTrainer(programId: string, expertId: string, input: { fee?: number; confirmed: boolean }) {
  const db = getCrmDb();
  const existing = (
    await db
      .select({ id: crmProgramTrainers.id })
      .from(crmProgramTrainers)
      .where(and(eq(crmProgramTrainers.programId, programId), eq(crmProgramTrainers.expertId, expertId)))
  )[0];
  if (existing) throw new CrmServiceError(409, 'CRM_ALREADY_LINKED', 'Cet expert est déjà formateur sur ce programme.');

  await db.insert(crmProgramTrainers).values({
    id: randomUUID(),
    programId,
    expertId,
    fee: input.fee,
    confirmed: input.confirmed,
    createdAt: new Date().toISOString(),
  });
}

export async function updateTrainer(trainerId: string, input: { fee?: number; confirmed?: boolean }) {
  const db = getCrmDb();
  const patch: Record<string, unknown> = {};
  if (input.fee !== undefined) patch.fee = input.fee;
  if (input.confirmed !== undefined) patch.confirmed = input.confirmed;
  if (Object.keys(patch).length === 0) return;
  await db.update(crmProgramTrainers).set(patch).where(eq(crmProgramTrainers.id, trainerId));
}

export async function removeTrainer(trainerId: string): Promise<void> {
  await getCrmDb().delete(crmProgramTrainers).where(eq(crmProgramTrainers.id, trainerId));
}

/* ─────────────────────────── Partners ─────────────────────────── */

export async function addPartner(programId: string, input: PartnerInput) {
  const db = getCrmDb();
  await db.insert(crmProgramPartners).values({
    id: randomUUID(),
    programId,
    partnershipId: input.partnershipId ?? null,
    organizationId: input.organizationId ?? null,
    role: input.role ?? null,
    createdAt: new Date().toISOString(),
  });
}

export async function removePartner(partnerId: string): Promise<void> {
  await getCrmDb().delete(crmProgramPartners).where(eq(crmProgramPartners.id, partnerId));
}

// Payment creation moved to services/payments.ts (Prompt 5) — one writer, not
// two. Program detail's "add payment" mini-form now POSTs to the standalone
// ADMIN-gated `/api/metworkcrm/payments` with `programId` preset, instead of
// a Program-scoped nested route.
