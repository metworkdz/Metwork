/**
 * METWORK OS CRM — Documents service.
 *
 * `attach`/`listFor`/`remove` against the polymorphic `crm_document_links`
 * table, plus `listAll` for the cross-entity browse page
 * (`/metworkcrm/documents`, Prompt 5) and `deleteDocumentLinksFor` — the
 * Prompt-5 mitigation the schema doc's own comment calls for: `entity_id`
 * isn't a real FK (SQLite can't enforce a polymorphic reference), so every
 * entity's delete function must clear its own document links itself, or a
 * deleted org/opportunity/etc. leaves dangling `crm_document_links` rows
 * pointing at nothing. Deleting a document here removes the DB row (and its
 * links, `ON DELETE CASCADE`) but does NOT call Cloudinary to free the asset
 * — that's the one piece still deferred, flagged in SESSION_LOG.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmDocumentLinks, crmDocuments } from '../db/schema';
import type { DocumentAttachInput } from '../validation/documents';
import { CrmNotFoundError } from './errors';

function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

export async function listDocumentsFor(entityType: string, entityId: string) {
  const db = getCrmDb();
  const rows = await db
    .select({ link: crmDocumentLinks, document: crmDocuments })
    .from(crmDocumentLinks)
    .innerJoin(crmDocuments, eq(crmDocumentLinks.documentId, crmDocuments.id))
    .where(and(eq(crmDocumentLinks.entityType, entityType as never), eq(crmDocumentLinks.entityId, entityId)))
    .orderBy(desc(crmDocuments.createdAt));

  return rows.map((r) => ({ ...r.document, linkId: r.link.id }));
}

export interface DocumentListFilters {
  q?: string;
  type?: string;
  limit: number;
  offset: number;
}

/** Cross-entity browse — every document regardless of what it's linked to. */
export async function listAllDocuments(filters: DocumentListFilters) {
  const db = getCrmDb();
  const clauses = [
    filters.type ? eq(crmDocuments.type, filters.type as never) : undefined,
    filters.q ? sql`(${crmDocuments.title} LIKE ${likeTerm(filters.q)} ESCAPE '\\' COLLATE NOCASE)` : undefined,
  ].filter(Boolean);
  const where = clauses.length > 0 ? and(...clauses) : undefined;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(crmDocuments)
      .where(where)
      .orderBy(desc(crmDocuments.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db.select({ n: sql<number>`count(*)` }).from(crmDocuments).where(where),
  ]);

  return { rows, total: Number(totalRows[0]?.n ?? 0) };
}

export async function attachDocument(input: DocumentAttachInput, actorId: string) {
  const db = getCrmDb();
  const now = new Date().toISOString();
  const id = randomUUID();

  await db.insert(crmDocuments).values({
    id,
    title: input.title,
    type: input.type,
    fileUrl: input.fileUrl,
    fileName: input.fileName ?? null,
    mimeType: input.mimeType ?? null,
    sizeBytes: input.sizeBytes,
    cloudinaryPublicId: input.cloudinaryPublicId ?? null,
    uploadedBy: actorId,
    createdAt: now,
    updatedAt: now,
    createdBy: actorId,
  });

  await db.insert(crmDocumentLinks).values({
    id: randomUUID(),
    documentId: id,
    entityType: input.entityType,
    entityId: input.entityId,
    createdAt: now,
  });

  return (await db.select().from(crmDocuments).where(eq(crmDocuments.id, id)))[0]!;
}

export async function deleteDocument(id: string): Promise<void> {
  const db = getCrmDb();
  const existing = (await db.select({ id: crmDocuments.id }).from(crmDocuments).where(eq(crmDocuments.id, id)))[0];
  if (!existing) throw new CrmNotFoundError('Document');
  await db.delete(crmDocuments).where(eq(crmDocuments.id, id));
}

/**
 * Call from every entity's delete function after the row itself is gone —
 * clears any `crm_document_links` rows pointing at it. A no-op (not an
 * error) when the entity had no documents.
 */
export async function deleteDocumentLinksFor(entityType: string, entityId: string): Promise<void> {
  const db = getCrmDb();
  await db
    .delete(crmDocumentLinks)
    .where(and(eq(crmDocumentLinks.entityType, entityType as never), eq(crmDocumentLinks.entityId, entityId)));
}
