/**
 * METWORK OS CRM — Documents service.
 *
 * MINIMAL, scoped to what OI Project detail needs — `attach`/`listFor`/
 * `remove` against the polymorphic `crm_document_links` table. NOT the full
 * cross-entity Documents browser (`/metworkcrm/documents`, still
 * "coming soon") — that owns type management, multi-entity search, and the
 * Cloudinary-asset-deletion story `crm_documents.cloudinary_public_id` was
 * added for. Deleting a document here removes the DB row (and its links,
 * `ON DELETE CASCADE`) but does NOT call Cloudinary to free the asset —
 * same deferred scope, flagged in SESSION_LOG.
 */
import { randomUUID } from 'node:crypto';
import { desc, eq, and } from 'drizzle-orm';
import { getCrmDb } from '../db/client';
import { crmDocumentLinks, crmDocuments } from '../db/schema';
import type { DocumentAttachInput } from '../validation/documents';
import { CrmNotFoundError } from './errors';

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
