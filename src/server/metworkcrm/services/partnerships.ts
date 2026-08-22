/**
 * METWORK OS CRM — Partnerships service.
 *
 * `crm_partnership_contacts` is a plain junction (no `is_primary` — unlike
 * Contacts' org-links, a partnership doesn't have one "primary" contact),
 * replaced wholesale on write, same pattern as `replaceContactOrganizations`.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import {
  crmContacts,
  crmInteractions,
  crmOrganizations,
  crmPartnershipContacts,
  crmPartnerships,
  crmTasks,
} from '../db/schema';
import type { InternalUser } from '../db/schema';
import type { PartnershipInput } from '../validation/partnerships';
import { redactMoney } from '../auth/guards';
import { CrmNotFoundError, CrmServiceError } from './errors';
import { checkPartnershipDeleteGuard, formatDeleteGuardMessage } from './delete-guard';
import { deleteDocumentLinksFor, listDocumentsFor } from './documents';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

const MONEY_FIELDS = ['valueAmount'] as const;

export interface PartnershipListFilters {
  q?: string;
  type?: string;
  stage?: string;
  organizationId?: string;
  limit: number;
  offset: number;
}

export async function listPartnerships(filters: PartnershipListFilters, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const clauses = [
    filters.type ? eq(crmPartnerships.type, filters.type as never) : undefined,
    filters.stage ? eq(crmPartnerships.stage, filters.stage as never) : undefined,
    filters.organizationId ? eq(crmPartnerships.organizationId, filters.organizationId) : undefined,
    filters.q ? sql`(${crmPartnerships.name} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmPartnerships)
      .where(where)
      .orderBy(desc(crmPartnerships.updatedAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmPartnerships).where(where),
  ]);

  return {
    rows: rows.map((r) => redactMoney(user, r, MONEY_FIELDS)),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

export async function getPartnershipDetail(id: string, user: Pick<InternalUser, 'role'>) {
  const db = getCrmDb();
  const partnership = (await db.select().from(crmPartnerships).where(eq(crmPartnerships.id, id)))[0];
  if (!partnership) throw new CrmNotFoundError('Partenariat');

  const [organization, contactLinks, tasks, interactions, documents] = await Promise.all([
    (await db.select().from(crmOrganizations).where(eq(crmOrganizations.id, partnership.organizationId)))[0] ?? null,
    db
      .select({ link: crmPartnershipContacts, contact: crmContacts })
      .from(crmPartnershipContacts)
      .innerJoin(crmContacts, eq(crmPartnershipContacts.contactId, crmContacts.id))
      .where(eq(crmPartnershipContacts.partnershipId, id)),
    db.select().from(crmTasks).where(eq(crmTasks.partnershipId, id)).orderBy(desc(crmTasks.createdAt)),
    db.select().from(crmInteractions).where(eq(crmInteractions.partnershipId, id)).orderBy(desc(crmInteractions.occurredAt)),
    listDocumentsFor('PARTNERSHIP', id),
  ]);

  return {
    partnership: redactMoney(user, partnership, MONEY_FIELDS),
    organization,
    contacts: contactLinks.map((r) => ({ ...r.contact, role: r.link.role })),
    documents,
    tasks,
    interactions,
  };
}

type ContactLink = { contactId: string; role?: string };

async function replaceContactLinksTx(db: ReturnType<typeof getCrmDb>, partnershipId: string, links: ContactLink[]) {
  const now = new Date().toISOString();
  await db.delete(crmPartnershipContacts).where(eq(crmPartnershipContacts.partnershipId, partnershipId));
  if (links.length > 0) {
    await db.insert(crmPartnershipContacts).values(
      links.map((l) => ({
        id: randomUUID(),
        partnershipId,
        contactId: l.contactId,
        role: l.role ?? null,
        createdAt: now,
      })),
    );
  }
}

export async function createPartnership(input: PartnershipInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmPartnerships).values({
    id,
    name: input.name,
    organizationId: input.organizationId,
    type: input.type,
    stage: input.stage,
    stageChangedAt: now,
    description: input.description ?? null,
    valueAmount: input.valueAmount,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    renewalDate: input.renewalDate ?? null,
    ownerId: input.ownerId ?? null,
    platformPartnerMembershipId: input.platformPartnerMembershipId ?? null,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  if (input.contacts && input.contacts.length > 0) {
    await replaceContactLinksTx(db, id, input.contacts);
  }

  return (await db.select().from(crmPartnerships).where(eq(crmPartnerships.id, id)))[0]!;
}

export async function updatePartnership(id: string, input: Partial<PartnershipInput>) {
  const db = getCrmDb();
  const existing = (await db.select().from(crmPartnerships).where(eq(crmPartnerships.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Partenariat');

  const { contacts, ...fields } = input;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { ...fields, updatedAt: now };
  if (input.stage && input.stage !== existing.stage) {
    patch.stageChangedAt = now;
  }

  if (Object.keys(fields).length > 0 || patch.stageChangedAt) {
    await db.update(crmPartnerships).set(patch).where(eq(crmPartnerships.id, id));
  }
  if (contacts) {
    await replaceContactLinksTx(db, id, contacts);
  }

  return (await db.select().from(crmPartnerships).where(eq(crmPartnerships.id, id)))[0]!;
}

export async function deletePartnership(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmPartnerships.id }).from(crmPartnerships).where(eq(crmPartnerships.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Partenariat');

  const guard = await checkPartnershipDeleteGuard(db, id);
  if (!guard.canDelete) {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', formatDeleteGuardMessage('ce partenariat', guard), {
      blockers: guard.blockers,
      cascades: guard.cascades,
    });
  }

  try {
    await db.delete(crmPartnerships).where(eq(crmPartnerships.id, id));
  } catch {
    throw new CrmServiceError(409, 'CRM_DELETE_BLOCKED', 'Impossible de supprimer ce partenariat — des éléments y sont encore rattachés.');
  }
  await deleteDocumentLinksFor('PARTNERSHIP', id);
}
