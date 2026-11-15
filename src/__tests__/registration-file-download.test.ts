/**
 * Opening an applicant's file — who may, and what they get.
 *
 * Files are private to the owner of the listing: the incubator that owns an
 * event or program, or the consultant that owns a consultant program. Anyone
 * else gets exactly the answer a missing file would get. What the owner gets is
 * the file as the applicant sent it (their name, the type we measured), shown
 * inline or as a download, never cached, never sniffed.
 *
 * Runs against a real folder for the storage layer (the dev fallback), plus the
 * Cloudinary path with the network stubbed — in particular the case where a
 * failed signed link answers 200 with an HTML page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { db } from '@/server/db/store';

const cloud = { configured: false };
vi.mock('@/lib/cloudinary', () => ({
  isConfigured: () => cloud.configured,
  signedRawDownloadUrl: (id: string) => `https://dl.test/${id}`,
  getAuthenticatedRawResource: async () => null,
  readAuthenticatedRawHead: async () => null,
  destroyAuthenticatedRaw: async () => undefined,
}));

const session = { ok: true, email: 'owner@inc.dz', mentorId: 'mentor-1' };
vi.mock('@/server/auth/api-guards', () => ({
  requireApiRole: vi.fn(async () =>
    session.ok
      ? { ok: true, user: { id: 'u', email: session.email, role: 'INCUBATOR', approvalStatus: 'APPROVED' } }
      : { ok: false, response: new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }) }),
}));
vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => (session.ok ? { ok: true, mentorId: session.mentorId } : {
    ok: false, response: new Response('{}', { status: 401 }),
  })),
}));

import { GET as incubatorOpen } from '@/app/api/incubator/registrations/[id]/files/[fieldId]/route';
import { GET as consultantOpen } from '@/app/api/consultant/registrations/[id]/files/[fieldId]/route';
import { buildRegistrationFilePublicId } from '@/server/registrations/files';
import { writeLocalRegistrationFile } from '@/server/registrations/file-storage';
import { buildRegistrationsCsv, incubatorScope, mentorScope } from '@/server/registrations/service';
import { contentDisposition } from '@/server/registrations/file-route';

const NOW = '2026-01-01T00:00:00.000Z';
const INC = 'inc-1';
const OTHER_INC_EMAIL = 'someone@else.dz';
const EVENT = '11111111-1111-4111-8111-111111111111';
const PROGRAM = '22222222-2222-4222-8222-222222222222';
const F_EVENT = '33333333-3333-4333-8333-333333333333';
const F_PROG = '44444444-4444-4444-8444-444444444444';
const R_EVENT = '55555555-5555-4555-8555-555555555555';
const R_PROG = '66666666-6666-4666-8666-666666666666';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5000, 9)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 4)]);

let dir: string;
let eventFileId: string;
let progFileId: string;

function field(id: string, type: 'EVENT' | 'PROGRAM', entityId: string, owner: Record<string, unknown>) {
  return {
    id, entityType: type, entityId, ...owner, label: 'Pitch deck', labelKey: null, type: 'FILE',
    options: null, optionKeys: null, required: false, order: 0, showWhen: null, createdAt: NOW, updatedAt: NOW,
  };
}
function registration(id: string, type: 'EVENT' | 'PROGRAM', entityId: string, fieldId: string, publicId: string, owner: Record<string, unknown>, file: unknown) {
  return {
    id, entityType: type, entityId, ...owner, userId: null, fullName: 'Amina Benali', email: 'amina@x.dz', phone: '+213700112233',
    answers: [{ fieldId, value: publicId, ...(file ? { file } : {}) }],
    status: 'CONFIRMED', clientId: null, createdAt: NOW, updatedAt: NOW,
  };
}

beforeEach(async () => {
  session.ok = true; session.email = 'owner@inc.dz'; session.mentorId = 'mentor-1';
  cloud.configured = false;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metwork-dl-'));
  process.env.LOCAL_UPLOADS_DIR = dir;

  eventFileId = buildRegistrationFilePublicId('EVENT', EVENT, F_EVENT);
  progFileId = buildRegistrationFilePublicId('PROGRAM', PROGRAM, F_PROG);
  await writeLocalRegistrationFile(eventFileId, PDF);
  await writeLocalRegistrationFile(progFileId, JPG);

  await db.update((d) => {
    d.incubators = [
      { id: INC, managerId: 'm', name: 'Hub', status: 'ACTIVE', email: 'owner@inc.dz' },
      { id: 'inc-2', managerId: 'm2', name: 'Other', status: 'ACTIVE', email: OTHER_INC_EMAIL },
    ] as never;
    d.users = [];
    d.events = [{ id: EVENT, incubatorId: INC, title: 'Demo Day', isActive: true }] as never;
    d.programs = [{ id: PROGRAM, incubatorId: null, mentorId: 'mentor-1', title: 'Coaching', isActive: true }] as never;
    d.registrationFormFields = [
      field(F_EVENT, 'EVENT', EVENT, { incubatorId: INC, mentorId: null }),
      field(F_PROG, 'PROGRAM', PROGRAM, { incubatorId: null, mentorId: 'mentor-1' }),
    ] as never;
    d.registrations = [
      registration(R_EVENT, 'EVENT', EVENT, F_EVENT, eventFileId, { incubatorId: INC, mentorId: null },
        { name: 'TiziTech deck.pdf', bytes: PDF.length, contentType: 'application/pdf' }),
      registration(R_PROG, 'PROGRAM', PROGRAM, F_PROG, progFileId, { incubatorId: null, mentorId: 'mentor-1' },
        { name: 'عرض تقديمي.jpg', bytes: JPG.length, contentType: 'image/jpeg' }),
    ] as never;
  });
});

afterEach(async () => {
  delete process.env.LOCAL_UPLOADS_DIR;
  vi.unstubAllGlobals();
  await fs.rm(dir, { recursive: true, force: true });
});

const ctx = (id: string, fieldId: string) => ({ params: Promise.resolve({ id, fieldId }) });
const req = (url: string) => new NextRequest(`http://localhost${url}`);
const openEvent = (qs = '') => incubatorOpen(req(`/api/incubator/registrations/${R_EVENT}/files/${F_EVENT}${qs}`), ctx(R_EVENT, F_EVENT));
const openProg = (qs = '') => consultantOpen(req(`/api/consultant/registrations/${R_PROG}/files/${F_PROG}${qs}`), ctx(R_PROG, F_PROG));

describe('the owning incubator', () => {
  it('opens the file inline, as the applicant named it, with the measured type', async () => {
    const res = await openEvent();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-length')).toBe(String(PDF.length));
    expect(res.headers.get('content-disposition')).toBe(
      `inline; filename="TiziTech deck.pdf"; filename*=UTF-8''TiziTech%20deck.pdf`,
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('serves a download on request', async () => {
    const res = await openEvent('?download=1');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="TiziTech deck.pdf"/);
  });
});

describe('the owning consultant', () => {
  it('opens a file on their own program, with an Arabic name intact', async () => {
    const res = await openProg();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    const cd = res.headers.get('content-disposition')!;
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent('عرض تقديمي.jpg')}`);
    expect(cd).not.toMatch(/[^\x20-\x7e]/); // header stays ASCII-safe
    expect(Buffer.from(await res.arrayBuffer()).equals(JPG)).toBe(true);
  });
});

describe('everyone else gets a plain 404', () => {
  it('another incubator', async () => {
    session.email = OTHER_INC_EMAIL;
    expect((await openEvent()).status).toBe(404);
  });
  it('another consultant', async () => {
    session.mentorId = 'mentor-2';
    expect((await openProg()).status).toBe(404);
  });
  it("an incubator asking for a consultant's registration, and the reverse", async () => {
    const asIncubator = await incubatorOpen(req('/x'), ctx(R_PROG, F_PROG));
    expect(asIncubator.status).toBe(404);
    const asConsultant = await consultantOpen(req('/x'), ctx(R_EVENT, F_EVENT));
    expect(asConsultant.status).toBe(404);
  });
  it('a signed-out caller is stopped by the guard', async () => {
    session.ok = false;
    expect((await openEvent()).status).toBe(401);
    expect((await openProg()).status).toBe(401);
  });
  it('a question that holds no file, or an unknown registration', async () => {
    expect((await incubatorOpen(req('/x'), ctx(R_EVENT, F_PROG))).status).toBe(404);
    expect((await incubatorOpen(req('/x'), ctx('77777777-7777-4777-8777-777777777777', F_EVENT))).status).toBe(404);
  });
});

describe('what is never served', () => {
  it('a record that points at some other asset', async () => {
    await db.update((d) => {
      d.registrations[0]!.answers[0]!.value = 'metwork/pitch-decks/pitch-deck-3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    });
    expect((await openEvent()).status).toBe(404);
  });
  it('an answer with no verified file facts', async () => {
    await db.update((d) => { delete d.registrations[0]!.answers[0]!.file; });
    expect((await openEvent()).status).toBe(404);
  });
  it('a file replaced behind the registration (same type, different size)', async () => {
    await fs.writeFile(path.join(dir, eventFileId), Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(99, 1)]));
    expect((await openEvent()).status).toBe(404);
  });
  it('a file that has gone missing from storage', async () => {
    await fs.rm(path.join(dir, eventFileId));
    expect((await openEvent()).status).toBe(404);
  });
  it('bytes that are no longer what was verified', async () => {
    await fs.writeFile(path.join(dir, eventFileId), Buffer.from('<html>not a pdf</html>'));
    expect((await openEvent()).status).toBe(404);
  });
});

describe('with Cloudinary as storage', () => {
  beforeEach(() => { cloud.configured = true; });

  it('streams the private asset through, never redirecting to it', async () => {
    const fetchMock = vi.fn(async () => new Response(PDF, { status: 200, headers: { 'content-length': String(PDF.length) } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await openEvent();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`https://dl.test/${eventFileId}`, expect.objectContaining({ signal: expect.anything() }));
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it('refuses a stored object whose size no longer matches what was verified', async () => {
    const other = Buffer.concat([PDF, Buffer.alloc(10)]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(other, { status: 200, headers: { 'content-length': String(other.length) } })));
    expect((await openEvent()).status).toBe(404);
  });

  it('refuses a "200 with an HTML error page" from a failed signed link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Invalid signature</html>', { status: 200 })));
    expect((await openEvent()).status).toBe(404);
  });

  it('answers 404 when the link is refused outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));
    expect((await openEvent()).status).toBe(404);
  });

  it('answers 503, not 404, when storage cannot be reached at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNRESET'); }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await openEvent()).status).toBe(503);
    spy.mockRestore();
  });
});

describe('contentDisposition', () => {
  it('keeps quotes and backslashes out of the header', () => {
    const h = contentDisposition('attachment', 'a"b\\c.pdf');
    expect(h.split(';')[1]).toBe(' filename="a_b_c.pdf"');
  });
});

describe('CSV export', () => {
  it('gives a file answer as a link to the owner-only route, not a storage id', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://metwork.dz/';
    const csv = await buildRegistrationsCsv('EVENT', EVENT, incubatorScope(INC));
    expect(csv).toContain(`https://metwork.dz/api/incubator/registrations/${R_EVENT}/files/${F_EVENT}`);
    expect(csv).not.toContain('metwork/registration-files');
  });
  it('uses the consultant route for a consultant export', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://metwork.dz';
    const csv = await buildRegistrationsCsv('PROGRAM', PROGRAM, mentorScope('mentor-1'));
    expect(csv).toContain(`https://metwork.dz/api/consultant/registrations/${R_PROG}/files/${F_PROG}`);
  });
  it('leaves the cell empty when nothing was attached', async () => {
    await db.update((d) => { d.registrations[0]!.answers = []; });
    const csv = await buildRegistrationsCsv('EVENT', EVENT, incubatorScope(INC));
    expect(csv).not.toContain('/files/');
  });
});
