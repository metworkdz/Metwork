/**
 * Publishing a certificate on LinkedIn.
 *
 * What must hold:
 *  - the post names the training, the trainer, the organiser and the end
 *    date, and tags Metwork with LinkedIn's exact mention syntax — every other
 *    reserved character escaped, or LinkedIn garbles the text;
 *  - only the signed share link from the email opens the flow (the QR token
 *    is public on the image itself);
 *  - LinkedIn's redirect is accepted only with this browser's state;
 *  - one certificate, one post — a retry opens the existing post;
 *  - a revoked certificate cannot be published.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import type * as ImagesModule from '@/server/certificates/images';

vi.hoisted(() => {
  process.env.LINKEDIN_CLIENT_ID = 'test-client';
  process.env.LINKEDIN_CLIENT_SECRET = 'test-secret';
  process.env.LINKEDIN_ORGANIZATION_ID = '123456';
  process.env.LINKEDIN_ORGANIZATION_NAME = 'Metwork';
});

vi.mock('@/server/certificates/images', async (orig) => ({
  ...(await orig<typeof ImagesModule>()),
  fetchCertificateImage: vi.fn(async () => null),
}));

import { db } from '@/server/db/store';
import { DEFAULT_CERTIFICATE_SETTINGS } from '@/server/certificates/types';
import {
  buildPostSegments,
  escapeLittle,
  toLittle,
  toPlain,
  type PostInput,
} from '@/server/certificates/linkedin/post-text';
import {
  certificateShareToken,
  newOAuthState,
  openOAuthState,
  parseCertificateShareToken,
  sealOAuthState,
} from '@/server/certificates/linkedin/config';
import { publishCertificateOnLinkedIn, resolveShareTarget } from '@/server/certificates/linkedin/service';
import { certificateEmail } from '@/server/certificates/send';

afterAll(() => {
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.LINKEDIN_CLIENT_SECRET;
  delete process.env.LINKEDIN_ORGANIZATION_ID;
  delete process.env.LINKEDIN_ORGANIZATION_NAME;
});

const BASE: PostInput = {
  lang: 'fr',
  programTitle: 'Techniques de Ventes et Négociations',
  organizer: 'Hub Oran',
  trainerName: 'Yacine Kheddaoui',
  endDate: '2026-10-30T11:00:00.000Z',
  verifyUrl: 'https://metwork.dz/attestation/Ab_c-9xYz123456789',
  metwork: { name: 'Metwork', organizationId: '123456' },
};

describe('post text', () => {
  it('says what, by whom, organised by whom, and when — and tags Metwork', () => {
    const plain = toPlain(buildPostSegments(BASE));
    expect(plain).toContain('« Techniques de Ventes et Négociations »');
    expect(plain).toContain('animée par Yacine Kheddaoui');
    expect(plain).toContain('organisée par Hub Oran sur @Metwork');
    expect(plain).toContain('achevée le 30 octobre 2026');
    expect(plain).toContain(BASE.verifyUrl);
  });

  it('writes the mention in LinkedIn’s syntax and escapes everything else', () => {
    const little = toLittle(buildPostSegments(BASE), '123456');
    expect(little).toContain('@[Metwork](urn:li:organization:123456)');
    // The link's underscore must not be read as markup.
    expect(little).toContain('Ab\\_c-9xYz123456789');
    expect(little).toContain('#Formation #Apprentissage #Metwork');
    // No stray, unescaped reserved character outside the mention and hashtags.
    const stripped = little
      .replace('@[Metwork](urn:li:organization:123456)', '')
      .replace(/#[\p{L}\p{N}]+/gu, '')
      .replace(/\\[\\|{}@[\]()<>#*_~]/g, '');
    expect(stripped).not.toMatch(/[\\|{}@[\]()<>#*_~]/);
  });

  it('escapes a title full of reserved characters', () => {
    const little = toLittle(buildPostSegments({ ...BASE, programTitle: 'C# & [IA] (niveau *2*)' }), '1');
    expect(little).toContain('C\\# & \\[IA\\] \\(niveau \\*2\\*\\)');
    expect(escapeLittle('a_b~c')).toBe('a\\_b\\~c');
  });

  it('drops the trainer clause when nobody is named', () => {
    const plain = toPlain(buildPostSegments({ ...BASE, trainerName: null }));
    expect(plain).not.toContain('animée par');
    expect(plain).toContain('formation « Techniques de Ventes et Négociations », organisée par Hub Oran');
  });

  it('names Metwork once when Metwork organised it', () => {
    const plain = toPlain(buildPostSegments({ ...BASE, organizer: 'Metwork' }));
    expect(plain).toContain('et organisée par @Metwork');
    expect(plain).not.toContain('Metwork sur @Metwork');
  });

  it('leaves Metwork untagged (plain text) without a page id', () => {
    expect(toLittle(buildPostSegments(BASE), null)).not.toContain('urn:li:organization');
  });

  it('is written in English and Arabic too', () => {
    expect(toPlain(buildPostSegments({ ...BASE, lang: 'en' }))).toContain('organised by Hub Oran on @Metwork, which ended on 30 October 2026');
    const ar = toPlain(buildPostSegments({ ...BASE, lang: 'ar' }));
    expect(ar).toContain('Yacine Kheddaoui');
    expect(ar).toContain('@Metwork');
    expect(ar).toContain('#تكوين');
  });
});

describe('share link and OAuth state', () => {
  it('round-trips a share link and refuses a forged one', () => {
    const token = certificateShareToken('cert-1');
    expect(parseCertificateShareToken(token)).toBe('cert-1');
    expect(parseCertificateShareToken(token.replace('cert-1', 'cert-2'))).toBeNull();
    expect(parseCertificateShareToken('cert-1')).toBeNull();
    expect(parseCertificateShareToken(`${token}.x`)).toBeNull();
  });

  it('opens a state only with the matching nonce, before it expires', () => {
    const state = newOAuthState('tok', 'fr', 1_000_000);
    const sealed = sealOAuthState(state);
    expect(openOAuthState(sealed, state.nonce, 1_000_000)?.shareToken).toBe('tok');
    expect(openOAuthState(sealed, 'another-nonce', 1_000_000)).toBeNull();
    expect(openOAuthState(sealed, state.nonce, 1_000_000 + 16 * 60_000)).toBeNull();
    expect(openOAuthState(`${sealed}x`, state.nonce, 1_000_000)).toBeNull();
    expect(openOAuthState(undefined, state.nonce)).toBeNull();
  });
});

// ── The publish flow, LinkedIn mocked at the network ──────────────────────

const NOW = '2026-10-31T00:00:00.000Z';

async function seed(extra: { revoked?: boolean } = {}): Promise<void> {
  await db.update((d) => {
    d.incubators = [{ id: 'inc-a', name: 'Hub Oran', managerId: 'mgr-a', logoUrl: null } as never];
    d.programs = [{
      id: 'p1', incubatorId: 'inc-a', incubatorName: 'Hub Oran', mentorId: null,
      title: 'Techniques de Ventes et Négociations', city: 'Oran',
      startDate: '2026-10-28T11:00:00.000Z', endDate: '2026-10-30T11:00:00.000Z',
      certificateSettings: { ...DEFAULT_CERTIFICATE_SETTINGS, trainerName: 'Yacine Kheddaoui' },
      isActive: true, createdAt: NOW, updatedAt: NOW,
    } as never];
    d.registrations = [{
      id: 'r1', entityType: 'PROGRAM', entityId: 'p1', incubatorId: 'inc-a', mentorId: null,
      fullName: 'Naouel Salhi', email: 'n@x.dz', phone: '', status: 'CONFIRMED', locale: 'fr',
      createdAt: NOW, updatedAt: NOW,
    } as never];
    d.certificates = [{
      id: 'cert-1', number: 'ATT-2026-0007', verifyToken: 'Ab_c-9xYz123456789', programId: 'p1',
      registrationId: 'r1', incubatorId: 'inc-a', mentorId: null, fullName: 'Naouel Salhi',
      civility: 'Mme', programTitle: 'Techniques de Ventes et Négociations', organizer: 'Hub Oran',
      startDate: '2026-10-28T11:00:00.000Z', endDate: '2026-10-30T11:00:00.000Z',
      issuedAt: NOW, updatedAt: NOW, revokedAt: extra.revoked ? NOW : null,
    } as never];
  });
}

type Call = { url: string; init: RequestInit };
let calls: Call[];

function mockLinkedIn(opts: { failPost?: boolean } = {}) {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.includes('/oauth/v2/accessToken')) return Response.json({ access_token: 'tok-1', expires_in: 3600 });
    if (url.includes('/v2/userinfo')) return Response.json({ sub: 'member42', name: 'Naouel Salhi' });
    if (url.includes('/rest/images')) {
      return Response.json({ value: { uploadUrl: 'https://www.linkedin.com/dms-uploads/x', image: 'urn:li:image:IMG1' } });
    }
    if (url.includes('/dms-uploads/')) return new Response(null, { status: 201 });
    if (url.includes('/rest/posts')) {
      if (opts.failPost) return new Response('{"message":"nope"}', { status: 422 });
      return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7000000000000000001' } });
    }
    return new Response('unexpected', { status: 500 });
  }));
}

describe('publishing', () => {
  beforeEach(async () => {
    await seed();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uploads the certificate image and posts it as the participant, with the tag', async () => {
    mockLinkedIn();
    const r = await publishCertificateOnLinkedIn(certificateShareToken('cert-1'), 'code-1');
    expect(r).toEqual({ ok: true, postUrl: 'https://www.linkedin.com/feed/update/urn:li:share:7000000000000000001/', already: false });

    const upload = calls.find((c) => c.url.includes('/dms-uploads/'))!;
    const png = Buffer.from(upload.init.body as Uint8Array);
    expect(png.subarray(1, 4).toString()).toBe('PNG');

    const post = JSON.parse(calls.find((c) => c.url.includes('/rest/posts'))!.init.body as string);
    expect(post.author).toBe('urn:li:person:member42');
    expect(post.content.media.id).toBe('urn:li:image:IMG1');
    expect(post.visibility).toBe('PUBLIC');
    expect(post.commentary).toContain('@[Metwork](urn:li:organization:123456)');
    expect(post.commentary).toContain('Yacine Kheddaoui');
    expect(post.commentary).toContain('30 octobre 2026');

    const cert = (await db.read()).certificates!.find((c) => c.id === 'cert-1')!;
    expect(cert.linkedinPostUrn).toBe('urn:li:share:7000000000000000001');
    expect(cert.linkedinClaimedAt).toBeNull();
  }, 30_000);

  it('never posts the same certificate twice', async () => {
    mockLinkedIn();
    await publishCertificateOnLinkedIn(certificateShareToken('cert-1'), 'code-1');
    mockLinkedIn();
    const again = await publishCertificateOnLinkedIn(certificateShareToken('cert-1'), 'code-2');
    expect(again.ok && again.already).toBe(true);
    expect(calls).toHaveLength(0);
  }, 30_000);

  it('releases the claim when LinkedIn refuses, so the participant can retry', async () => {
    mockLinkedIn({ failPost: true });
    const r = await publishCertificateOnLinkedIn(certificateShareToken('cert-1'), 'code-1');
    expect(r).toEqual({ ok: false, reason: 'LINKEDIN_ERROR' });
    const cert = (await db.read()).certificates!.find((c) => c.id === 'cert-1')!;
    expect(cert.linkedinPostUrn ?? null).toBeNull();
    expect(cert.linkedinClaimedAt).toBeNull();
  }, 30_000);

  it('refuses a revoked certificate and a forged link without calling LinkedIn', async () => {
    await seed({ revoked: true });
    mockLinkedIn();
    expect(await publishCertificateOnLinkedIn(certificateShareToken('cert-1'), 'c')).toEqual({ ok: false, reason: 'REVOKED' });
    expect(await publishCertificateOnLinkedIn('cert-1.forged', 'c')).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(calls).toHaveLength(0);
  });

  it('the share page and the email agree on the link', async () => {
    const target = await resolveShareTarget(certificateShareToken('cert-1'));
    expect(target.ok).toBe(true);
    const d = await db.read();
    const { html } = certificateEmail({ registration: d.registrations[0]!, certificate: d.certificates![0]! });
    expect(html).toContain(`/fr/attestation/linkedin/${certificateShareToken('cert-1')}`);
    expect(html).toContain('Partager sur LinkedIn');
  });
});
