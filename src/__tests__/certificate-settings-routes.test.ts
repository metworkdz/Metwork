/**
 * Certificate settings and preview, through the real route files, from both
 * populations that host programs.
 *
 * The interesting questions are the ownership ones: an incubator and a
 * consultant share one set of handlers, so the scope each route file resolves
 * is the whole security boundary — and a signature image is a URL the server
 * will later fetch, so what the schema admits matters as much as who saves.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type * as ImagesModule from '@/server/certificates/images';

const incubatorActor = { id: 'mgr-a', email: 'a@x.dz', role: 'INCUBATOR' };
let incubatorUser: typeof incubatorActor | null = incubatorActor;
let consultantId: string | null = 'mentor-1';

vi.mock('@/server/auth/api-guards', () => {
  const guard = vi.fn(async () => incubatorUser
    ? { ok: true, user: incubatorUser }
    : { ok: false, response: new Response('unauthorised', { status: 401 }) });
  return { requireApiRole: guard, requireApprovedApiRole: guard };
});

vi.mock('@/server/mentors/access', () => ({
  requireConsultant: vi.fn(async () => consultantId
    ? { ok: true, mentorId: consultantId }
    : { ok: false, response: new Response('unauthorised', { status: 401 }) }),
}));

// The preview must never reach out to the network from a test.
vi.mock('@/server/certificates/images', async (orig) => ({
  ...(await orig<typeof ImagesModule>()),
  fetchCertificateImage: vi.fn(async () => null),
}));

import { db } from '@/server/db/store';
import { DEFAULT_CERTIFICATE_SETTINGS, type CertificateSettings } from '@/server/certificates/types';
import { certificateSettingsSchema } from '@/server/certificates/schema';

const NOW = '2026-09-01T00:00:00.000Z';
const INC_A = 'inc-a', INC_B = 'inc-b';

function program(id: string, owner: { incubatorId?: string; mentorId?: string }, updatedAt = NOW) {
  return {
    id,
    incubatorId: owner.incubatorId ?? null,
    incubatorName: owner.incubatorId ? 'Hub A' : '',
    mentorId: owner.mentorId ?? null,
    mentorName: owner.mentorId ? 'Amina B.' : null,
    title: `Programme ${id}`,
    city: 'Oran',
    startDate: '2026-09-08T08:00:00.000Z',
    endDate: '2026-09-20T16:00:00.000Z',
    isActive: true,
    createdAt: NOW,
    updatedAt,
  } as never;
}

beforeEach(async () => {
  incubatorUser = incubatorActor;
  consultantId = 'mentor-1';
  await db.update((d) => {
    d.users = [];
    d.incubators = [
      { id: INC_A, name: 'Hub A', status: 'ACTIVE', managerId: 'mgr-a', email: 'a@x.dz', stampUrl: null } as never,
      { id: INC_B, name: 'Hub B', status: 'ACTIVE', managerId: 'mgr-b', email: 'b@x.dz' } as never,
    ];
    d.mentors = [
      { id: 'mentor-1', fullName: 'Amina Benali', approvalStatus: 'APPROVED' } as never,
      { id: 'mentor-2', fullName: 'Karim Saidi', approvalStatus: 'APPROVED' } as never,
    ];
    d.programs = [
      program('p-a', { incubatorId: INC_A }),
      program('p-b', { incubatorId: INC_B }),
      program('p-m1', { mentorId: 'mentor-1' }),
      // A consultant program carrying a stale incubatorId must still never
      // answer to that incubator.
      { ...(program('p-m2', { mentorId: 'mentor-2' }) as object), incubatorId: INC_A } as never,
    ];
    d.registrations = [
      { id: 'r1', entityType: 'PROGRAM', entityId: 'p-a', status: 'CONFIRMED', fullName: 'Djihene Amara' } as never,
    ];
  });
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const incubatorRoute = () => import('@/app/api/incubator/programs/[id]/certificates/route');
const incubatorPreview = () => import('@/app/api/incubator/programs/[id]/certificates/preview/route');
const consultantRoute = () => import('@/app/api/consultant/programs/[id]/certificates/route');
const consultantPreview = () => import('@/app/api/consultant/programs/[id]/certificates/preview/route');

const custom: CertificateSettings = {
  ...DEFAULT_CERTIFICATE_SETTINGS,
  template: 'CADRE',
  font: 'SPECTRAL',
  primaryColor: '#2d6cdf',
  title: 'CERTIFICAT',
};

async function saveAsIncubator(id: string, settings: unknown) {
  const { PUT } = await incubatorRoute();
  return PUT(req(`/api/incubator/programs/${id}/certificates`, 'PUT', { settings }), ctx(id));
}

describe('reading settings', () => {
  it('offers the Metwork model before anything is saved', async () => {
    const { GET } = await incubatorRoute();
    const res = await GET(req('/api/incubator/programs/p-a/certificates', 'GET'), ctx('p-a'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(false);
    expect(body.settings).toEqual(DEFAULT_CERTIFICATE_SETTINGS);
    expect(body.context).toMatchObject({ programTitle: 'Programme p-a', organizer: 'Hub A', city: 'Oran' });
    expect(body.hasStamp).toBe(false);
    expect(body.sampleName).toBe('Djihene Amara');
  });

  it('a consultant is the organizer of their own program', async () => {
    const { GET } = await consultantRoute();
    const body = await (await GET(req('/api/consultant/programs/p-m1/certificates', 'GET'), ctx('p-m1'))).json();
    expect(body.context.organizer).toBe('Amina Benali');
    // Consultants have no stamp to offer.
    expect(body.hasStamp).toBe(false);
  });

  it('a new program inherits the host\'s last saved settings, never another host\'s', async () => {
    await db.update((d) => {
      d.programs.push(program('p-a2', { incubatorId: INC_A }, '2026-09-02T00:00:00.000Z'));
    });
    await saveAsIncubator('p-a2', custom);

    // Hub B saved something even more recent — Hub A must not see it.
    await db.update((d) => {
      const theirs = d.programs.find((p) => p.id === 'p-b')!;
      theirs.certificateSettings = { ...custom, title: 'SECRET B' };
      theirs.updatedAt = '2027-01-01T00:00:00.000Z';
    });

    const { GET } = await incubatorRoute();
    const body = await (await GET(req('/api/incubator/programs/p-a/certificates', 'GET'), ctx('p-a'))).json();
    expect(body.saved).toBe(false);
    expect(body.settings.title).toBe('CERTIFICAT');
  });
});

describe('ownership', () => {
  it('an incubator cannot read or write another incubator\'s program', async () => {
    const { GET } = await incubatorRoute();
    expect((await GET(req('/api/incubator/programs/p-b/certificates', 'GET'), ctx('p-b'))).status).toBe(404);
    expect((await saveAsIncubator('p-b', custom)).status).toBe(404);
    const d = await db.read();
    expect(d.programs.find((p) => p.id === 'p-b')!.certificateSettings).toBeUndefined();
  });

  it('an incubator cannot reach a consultant\'s program, even one with a stale incubatorId', async () => {
    expect((await saveAsIncubator('p-m2', custom)).status).toBe(404);
    expect((await saveAsIncubator('p-m1', custom)).status).toBe(404);
  });

  it('a consultant cannot reach an incubator\'s or another consultant\'s program', async () => {
    const { PUT } = await consultantRoute();
    for (const id of ['p-a', 'p-m2']) {
      const res = await PUT(req(`/api/consultant/programs/${id}/certificates`, 'PUT', { settings: custom }), ctx(id));
      expect(res.status).toBe(404);
    }
    const d = await db.read();
    expect(d.programs.every((p) => !p.certificateSettings)).toBe(true);
  });

  it('previews refuse someone else\'s program too', async () => {
    const { POST } = await consultantPreview();
    const res = await POST(req('/api/consultant/programs/p-a/certificates/preview', 'POST', { settings: custom }), ctx('p-a'));
    expect(res.status).toBe(404);
  });

  it('no session, no access', async () => {
    incubatorUser = null;
    consultantId = null;
    const { GET } = await incubatorRoute();
    expect((await GET(req('/api/incubator/programs/p-a/certificates', 'GET'), ctx('p-a'))).status).toBe(401);
    const { POST } = await consultantPreview();
    expect((await POST(req('/x', 'POST', { settings: custom }), ctx('p-m1'))).status).toBe(401);
  });
});

describe('saving', () => {
  it('saves and reads back', async () => {
    const res = await saveAsIncubator('p-a', custom);
    expect(res.status).toBe(200);
    const { GET } = await incubatorRoute();
    const body = await (await GET(req('/api/incubator/programs/p-a/certificates', 'GET'), ctx('p-a'))).json();
    expect(body.saved).toBe(true);
    expect(body.settings).toMatchObject({ template: 'CADRE', font: 'SPECTRAL', title: 'CERTIFICAT' });
  });

  it('a consultant saves on their own program', async () => {
    const { PUT } = await consultantRoute();
    const res = await PUT(req('/api/consultant/programs/p-m1/certificates', 'PUT', { settings: custom }), ctx('p-m1'));
    expect(res.status).toBe(200);
  });

  it('refuses a malformed body', async () => {
    const { PUT } = await incubatorRoute();
    const res = await PUT(req('/api/incubator/programs/p-a/certificates', 'PUT', '{not json'), ctx('p-a'));
    expect(res.status).toBe(400);
    expect((await saveAsIncubator('p-a', undefined)).status).toBe(422);
  });

  it.each([
    ['a colour that is not hex', { primaryColor: 'red' }],
    ['a CSS injection in a colour', { darkColor: '#000000;background:url(x)' }],
    ['an empty title', { title: '   ' }],
    ['a title too long to print', { title: 'x'.repeat(41) }],
    ['a paragraph too long to read', { body: 'x'.repeat(901) }],
    ['no signatory', { signatories: [] }],
    ['three signatories', { signatories: [{ name: '', role: 'a' }, { name: '', role: 'b' }, { name: '', role: 'c' }] }],
    ['an unknown template', { template: 'COMIC' }],
    ['an unknown font', { font: 'COMIC_SANS' }],
  ])('refuses %s', async (_label, patch) => {
    const res = await saveAsIncubator('p-a', { ...custom, ...patch });
    expect(res.status).toBe(422);
    const d = await db.read();
    expect(d.programs.find((p) => p.id === 'p-a')!.certificateSettings).toBeUndefined();
  });
});

describe('signature images the server would fetch', () => {
  const withImage = (imageUrl: string) => ({ ...custom, signatories: [{ name: '', role: 'Signature', imageUrl }] });

  it.each([
    'http://res.cloudinary.com/demo/image/upload/sig.png',
    'https://evil.example/sig.png',
    'https://169.254.169.254/latest/meta-data',
    'https://res.cloudinary.com.evil.example/sig.png',
    'https://user:pass@res.cloudinary.com/demo/sig.png',
    'file:///etc/passwd',
    '/uploads/sig.png',
  ])('refuses %s', (url) => {
    expect(certificateSettingsSchema.safeParse(withImage(url)).success).toBe(false);
  });

  it('accepts an image uploaded to Cloudinary', () => {
    const url = process.env.CLOUDINARY_CLOUD_NAME
      ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1/sig.png`
      : 'https://res.cloudinary.com/demo/image/upload/v1/sig.png';
    expect(certificateSettingsSchema.safeParse(withImage(url)).success).toBe(true);
  });

  it('accepts no image at all', () => {
    expect(certificateSettingsSchema.safeParse({ ...custom, signatories: [{ name: '', role: 'x', imageUrl: null }] }).success).toBe(true);
    expect(certificateSettingsSchema.safeParse({ ...custom, signatories: [{ name: '', role: 'x' }] }).success).toBe(true);
  });
});

describe('preview', () => {
  it('draws a PDF from unsaved settings, and saves nothing', async () => {
    const { POST } = await incubatorPreview();
    const res = await POST(
      req('/api/incubator/programs/p-a/certificates/preview', 'POST', { settings: custom, mode: 'DIGITAL' }),
      ctx('p-a'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const d = await db.read();
    expect(d.programs.find((p) => p.id === 'p-a')!.certificateSettings).toBeUndefined();
  });

  it('defaults to the print version and refuses an unknown mode', async () => {
    const { POST } = await consultantPreview();
    const ok = await POST(req('/x', 'POST', { settings: custom }), ctx('p-m1'));
    expect(ok.status).toBe(200);
    const bad = await POST(req('/x', 'POST', { settings: custom, mode: 'FAX' }), ctx('p-m1'));
    expect(bad.status).toBe(422);
  });

  it('refuses invalid settings before drawing anything', async () => {
    const { POST } = await incubatorPreview();
    const res = await POST(req('/x', 'POST', { settings: { ...custom, primaryColor: 'nope' } }), ctx('p-a'));
    expect(res.status).toBe(422);
  });
});
