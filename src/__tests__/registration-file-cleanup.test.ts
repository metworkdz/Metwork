/**
 * Files live exactly as long as something points at them.
 *
 * Also pins the bug this work uncovered: saving the form builder used to give
 * EVERY question a new id, which detached all existing answers from their
 * questions. With file questions that meant correcting a typo hid every pitch
 * deck already collected. Saved questions now keep their id.
 *
 * Storage is a real temp folder (the dev fallback), so "deleted" means the file
 * is genuinely gone from disk.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => false,
  getAuthenticatedRawResource: async () => { throw new Error('local mode only'); },
  readAuthenticatedRawHead: async () => { throw new Error('local mode only'); },
  destroyAuthenticatedRaw: async () => { throw new Error('local mode only'); },
  listAuthenticatedRawByPrefix: async () => { throw new Error('local mode only'); },
  signedRawDownloadUrl: () => { throw new Error('local mode only'); },
}));

import {
  deleteFormField,
  deleteRegistration,
  incubatorScope,
  listFormFields,
  pruneListingChildrenSync,
  replaceFormFields,
} from '@/server/registrations/service';
import { buildRegistrationFilePublicId } from '@/server/registrations/files';
import { statRegistrationFile, writeLocalRegistrationFile } from '@/server/registrations/file-storage';
import {
  removeUnreferencedRegistrationFiles,
  sweepRegistrationFiles,
  SWEEP_MIN_AGE_MS,
} from '@/server/registrations/file-cleanup';
import { GET as cronGet } from '@/app/api/cron/sweep-registration-files/route';

const NOW = '2026-01-01T00:00:00.000Z';
const INC = 'inc-clean';
const OWNER = incubatorScope(INC);
const EVENT = '11111111-1111-4111-8111-111111111111';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(512, 3)]);

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metwork-clean-'));
  process.env.LOCAL_UPLOADS_DIR = dir;
  await db.update((d) => {
    d.registrationFormFields = []; d.registrations = []; d.bookings = [];
    d.events = [{ id: EVENT, incubatorId: INC, title: 'Demo', isActive: true }] as never;
    d.programs = [];
  });
});
afterEach(async () => {
  delete process.env.LOCAL_UPLOADS_DIR;
  delete process.env.CRON_SECRET;
  await fs.rm(dir, { recursive: true, force: true });
});

type RowInput = Parameters<typeof replaceFormFields>[3][number];
const row = (over: Record<string, unknown>): RowInput => ({
  label: 'Q', labelKey: null, type: 'SHORT_TEXT', options: null, optionKeys: null,
  required: false, order: 0, showWhen: null, ...over,
}) as RowInput;

async function putFile(fieldId: string, ageMs = 0): Promise<string> {
  const id = buildRegistrationFilePublicId('EVENT', EVENT, fieldId);
  await writeLocalRegistrationFile(id, PDF);
  if (ageMs) {
    const t = new Date(Date.now() - ageMs);
    await fs.utimes(path.join(dir, id), t, t);
  }
  return id;
}
const exists = async (id: string) => (await statRegistrationFile(id)) !== null;

async function addRegistration(id: string, answers: unknown[], status = 'CONFIRMED') {
  await db.update((d) => {
    d.registrations.push({
      id, entityType: 'EVENT', entityId: EVENT, incubatorId: INC, mentorId: null, userId: null,
      fullName: 'A B', email: `${id}@x.dz`, phone: '+213700000000', answers, status, clientId: null,
      createdAt: NOW, updatedAt: NOW,
    } as never);
  });
}
const fileAnswer = (fieldId: string, value: string) => ({
  fieldId, value, file: { name: 'deck.pdf', bytes: PDF.length, contentType: 'application/pdf' },
});

/* ─────────────────────────── Stable question ids ─────────────────────────── */

describe('saving the form builder keeps the questions\' ids', () => {
  it('a saved question keeps its id, and so its answers, when it is edited', async () => {
    const [name, deck] = await replaceFormFields('EVENT', EVENT, OWNER, [
      row({ label: 'Startup', order: 0 }), row({ label: 'Pitch deck', type: 'FILE', order: 1 }),
    ]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [{ fieldId: name!.id, value: 'Acme' }, fileAnswer(deck!.id, id)]);

    // The host fixes a typo and saves again, sending back the ids it loaded.
    const after = await replaceFormFields('EVENT', EVENT, OWNER, [
      { ...row({ label: 'Startup name', order: 0 }), id: name!.id },
      { ...row({ label: 'Pitch deck (PDF)', type: 'FILE', order: 1 }), id: deck!.id },
    ]);
    expect(after.map((f) => f.id)).toEqual([name!.id, deck!.id]);
    expect((await db.read()).registrations[0]!.answers).toHaveLength(2);
    expect(await exists(id)).toBe(true);
  });

  it('a new question (no id) gets a fresh one, and an id from elsewhere is not trusted', async () => {
    const [a] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'A' })]);
    const stolen = '99999999-9999-4999-8999-999999999999';
    const after = await replaceFormFields('EVENT', EVENT, OWNER, [
      { ...row({ label: 'A' }), id: a!.id },
      { ...row({ label: 'B', order: 1 }), id: stolen },
      row({ label: 'C', order: 2 }),
    ]);
    expect(after[0]!.id).toBe(a!.id);
    expect(after[1]!.id).not.toBe(stolen);
    expect(new Set(after.map((f) => f.id)).size).toBe(3);
  });

  it('the same id sent twice is used once', async () => {
    const [a] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'A' })]);
    const after = await replaceFormFields('EVENT', EVENT, OWNER, [
      { ...row({ label: 'A' }), id: a!.id },
      { ...row({ label: 'A copy', order: 1 }), id: a!.id },
    ]);
    expect(new Set(after.map((f) => f.id)).size).toBe(2);
  });

  it('keeps createdAt for a kept question', async () => {
    const [a] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'A' })]);
    const [b] = await replaceFormFields('EVENT', EVENT, OWNER, [{ ...row({ label: 'A2' }), id: a!.id }]);
    expect(b!.createdAt).toBe(a!.createdAt);
  });
});

/* ─────────────────────────── Deleting with their owner ─────────────────────────── */

describe('files go when what holds them goes', () => {
  it('removing a file question in the builder deletes its answers and files', async () => {
    const [name, deck] = await replaceFormFields('EVENT', EVENT, OWNER, [
      row({ label: 'Startup' }), row({ label: 'Deck', type: 'FILE', order: 1 }),
    ]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [{ fieldId: name!.id, value: 'Acme' }, fileAnswer(deck!.id, id)]);

    await replaceFormFields('EVENT', EVENT, OWNER, [{ ...row({ label: 'Startup' }), id: name!.id }]);

    expect(await exists(id)).toBe(false);
    expect((await db.read()).registrations[0]!.answers).toEqual([{ fieldId: name!.id, value: 'Acme' }]);
  });

  it('turning a file question into text (or back) drops the old answers and files', async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)]);

    await replaceFormFields('EVENT', EVENT, OWNER, [{ ...row({ label: 'Deck', type: 'SHORT_TEXT' }), id: deck!.id }]);
    expect(await exists(id)).toBe(false);
    expect((await db.read()).registrations[0]!.answers).toEqual([]);
  });

  it('changing between two non-file types keeps the answers', async () => {
    const [q] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Why', type: 'SHORT_TEXT' })]);
    await addRegistration('r1', [{ fieldId: q!.id, value: 'because' }]);
    await replaceFormFields('EVENT', EVENT, OWNER, [{ ...row({ label: 'Why', type: 'LONG_TEXT' }), id: q!.id }]);
    expect((await db.read()).registrations[0]!.answers).toHaveLength(1);
  });

  it('deleting a question deletes its files', async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)]);
    expect(await deleteFormField(deck!.id, OWNER)).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it('permanently deleting a cancelled registration deletes its files', async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)], 'CANCELLED');
    expect((await deleteRegistration('r1', OWNER)).ok).toBe(true);
    expect(await exists(id)).toBe(false);
  });

  it('keeps a file another registration still points at', async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)], 'CANCELLED');
    await addRegistration('r2', [fileAnswer(deck!.id, id)]);
    await deleteRegistration('r1', OWNER);
    expect(await exists(id)).toBe(true);
  });

  it('a registration that is not cancelled is not deleted, so its file stays', async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)]);
    expect((await deleteRegistration('r1', OWNER)).ok).toBe(false);
    expect(await exists(id)).toBe(true);
  });

  it("deleting a listing hands back its registrations' files", async () => {
    const [deck] = await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'Deck', type: 'FILE' })]);
    const id = await putFile(deck!.id);
    await addRegistration('r1', [fileAnswer(deck!.id, id)]);

    let fileIds: string[] = [];
    await db.update((d) => {
      d.events = [];
      fileIds = pruneListingChildrenSync(d, 'EVENT', EVENT).fileIds;
    });
    expect(fileIds).toEqual([id]);
    await removeUnreferencedRegistrationFiles(fileIds);
    expect(await exists(id)).toBe(false);
  });

  it('never deletes anything that is not one of its own files', async () => {
    expect(await removeUnreferencedRegistrationFiles(['metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301', '../../etc/passwd'])).toBe(0);
  });
});

/* ─────────────────────────── The sweep ─────────────────────────── */

describe('sweepRegistrationFiles', () => {
  const FIELD = '33333333-3333-4333-8333-333333333333';
  const DAY = SWEEP_MIN_AGE_MS;

  it('deletes old unreferenced files and keeps everything else', async () => {
    const kept = await putFile(FIELD, 5 * DAY);          // held by a registration
    const young = await putFile(FIELD, 60 * 60_000);     // uploaded an hour ago, may still be submitted
    const orphan = await putFile(FIELD, 3 * DAY);        // nothing points at it
    const pending = await putFile(FIELD, 3 * DAY);       // an unpaid checkout will need it
    const expired = await putFile(FIELD, 20 * DAY);      // a checkout nobody paid, long dead
    await addRegistration('r1', [fileAnswer(FIELD, kept)]);
    await db.update((d) => {
      d.bookings.push(
        { id: 'b1', status: 'PENDING_PAYMENT', createdAt: new Date(Date.now() - 2 * DAY).toISOString(),
          registrationDraft: { entityType: 'EVENT', answers: [fileAnswer(FIELD, pending)] } } as never,
        { id: 'b2', status: 'PENDING_PAYMENT', createdAt: new Date(Date.now() - 19 * DAY).toISOString(),
          registrationDraft: { entityType: 'EVENT', answers: [fileAnswer(FIELD, expired)] } } as never,
      );
    });

    const result = await sweepRegistrationFiles();

    expect(result).toMatchObject({ scanned: 5, referenced: 2, tooYoung: 1, deleted: 2, foreign: 0 });
    expect(await exists(kept)).toBe(true);
    expect(await exists(young)).toBe(true);
    expect(await exists(pending)).toBe(true);
    expect(await exists(orphan)).toBe(false);
    expect(await exists(expired)).toBe(false);
  });

  it('does not keep a file for a checkout that was cancelled — only an UNPAID one holds a file', async () => {
    const f = await putFile(FIELD, 3 * DAY);
    await db.update((d) => {
      d.bookings.push({ id: 'b1', status: 'CANCELLED', createdAt: new Date().toISOString(),
        registrationDraft: { entityType: 'EVENT', answers: [fileAnswer(FIELD, f)] } } as never);
    });
    await sweepRegistrationFiles();
    expect(await exists(f)).toBe(false);
  });

  it('leaves alone anything in the folder that is not one of its files', async () => {
    const stray = path.join(dir, 'metwork/registration-files/README.txt');
    await fs.mkdir(path.dirname(stray), { recursive: true });
    await fs.writeFile(stray, 'x');
    const old = new Date(Date.now() - 30 * DAY);
    await fs.utimes(stray, old, old);
    const result = await sweepRegistrationFiles();
    expect(result.foreign).toBe(1);
    await expect(fs.stat(stray)).resolves.toBeTruthy();
  });

  it('is idempotent', async () => {
    await putFile(FIELD, 3 * DAY);
    expect((await sweepRegistrationFiles()).deleted).toBe(1);
    expect((await sweepRegistrationFiles()).deleted).toBe(0);
  });
});

describe('GET /api/cron/sweep-registration-files', () => {
  const call = (auth?: string) => cronGet(new NextRequest('http://localhost/api/cron/sweep-registration-files', {
    headers: auth ? { authorization: auth } : {},
  }));

  it('refuses a caller without the cron secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
  });
  it('runs for the cron secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = await call('Bearer s3cret');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deleted: 0 });
  });
});

/* ─────────────────────────── Builder round trip ─────────────────────────── */

describe('the builder payload', () => {
  it('a field list read back from the server and re-saved is stable', async () => {
    await replaceFormFields('EVENT', EVENT, OWNER, [row({ label: 'A' }), row({ label: 'B', type: 'FILE', order: 1 })]);
    const loaded = await listFormFields('EVENT', EVENT);
    const resaved = await replaceFormFields('EVENT', EVENT, OWNER, loaded.map((f) => ({
      id: f.id, label: f.label, labelKey: f.labelKey ?? null, type: f.type, options: f.options,
      optionKeys: f.optionKeys ?? null, required: f.required, order: f.order, showWhen: f.showWhen ?? null,
    })));
    expect(resaved.map((f) => f.id)).toEqual(loaded.map((f) => f.id));
  });
});
