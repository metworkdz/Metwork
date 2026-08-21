/**
 * METWORK OS CRM — Documents service (minimal attach/list/delete scope).
 * Isolated in-memory DB per Prompt 1's pattern — never touches `.crm-local.db`.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createCrmDb, __setCrmDbForTests, type CrmDatabase } from '@/server/metworkcrm/db/client';
import { runCrmMigrations } from '@/server/metworkcrm/db/migrate';
import { attachDocument, deleteDocument, listDocumentsFor } from '@/server/metworkcrm/services/documents';
import { createOiProject } from '@/server/metworkcrm/services/oi-projects';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';

const MEM = 'file::memory:';
let db: CrmDatabase;
const ACTOR = 'test-actor';

beforeAll(async () => {
  db = createCrmDb(MEM);
  __setCrmDbForTests(db);
  await runCrmMigrations(db, MEM);
  const now = new Date().toISOString();
  await db.run(sql`
    INSERT INTO internal_users (id, name, email, password_hash, role, must_change_password, is_active, created_at, updated_at)
    VALUES (${ACTOR}, 'Test Actor', 'actor@metwork.dz', 'x', 'ADMIN', 0, 1, ${now}, ${now})
  `);
});

beforeEach(async () => {
  await db.run(sql`DELETE FROM crm_document_links`);
  await db.run(sql`DELETE FROM crm_documents`);
  await db.run(sql`DELETE FROM crm_oi_projects`);
});

describe('Documents — attach/list/delete', () => {
  it('attaches a document to an OI project and lists it back', async () => {
    const project = await createOiProject({ title: 'Doc test', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    const doc = await attachDocument(
      {
        title: 'Convention signée.pdf',
        type: 'CONVENTION',
        entityType: 'OI_PROJECT',
        entityId: project.id,
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/metwork/crm-documents/abc.pdf',
        fileName: 'Convention signée.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 12345,
        cloudinaryPublicId: 'abc',
      },
      ACTOR,
    );
    expect(doc.title).toBe('Convention signée.pdf');

    const list = await listDocumentsFor('OI_PROJECT', project.id);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(doc.id);
  });

  it('returns an empty list for an entity with no documents', async () => {
    const list = await listDocumentsFor('OI_PROJECT', 'does-not-exist');
    expect(list).toEqual([]);
  });

  it('deletes a document and cascades its link', async () => {
    const project = await createOiProject({ title: 'Doc delete test', stage: 'ENTREPRISE_IDENTIFIEE', currency: 'DZD' }, ACTOR);
    const doc = await attachDocument(
      {
        title: 'Rapport.pdf',
        type: 'RAPPORT',
        entityType: 'OI_PROJECT',
        entityId: project.id,
        fileUrl: 'https://res.cloudinary.com/demo/raw/upload/v1/metwork/crm-documents/xyz.pdf',
      },
      ACTOR,
    );

    await deleteDocument(doc.id);
    const list = await listDocumentsFor('OI_PROJECT', project.id);
    expect(list).toEqual([]);

    const links = await db.all(sql`SELECT * FROM crm_document_links WHERE document_id = ${doc.id}`);
    expect(links).toHaveLength(0);
  });

  it('throws CrmNotFoundError deleting a missing document', async () => {
    await expect(deleteDocument('nope')).rejects.toBeInstanceOf(CrmNotFoundError);
  });
});
