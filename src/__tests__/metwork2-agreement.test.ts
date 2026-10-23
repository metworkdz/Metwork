/**
 * Metwork 2.0 phase 8b — the trial sprint and the cofounder agreement.
 * Evidence rules: only the two founders, each fills only their own identity,
 * text frozen at signature, no edits after the first signature, drawn
 * signature + one-time code per signer, PDF rendered and hashed on the
 * second signature, then immutable.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db/store';
import { createMemoryCofounderRepo, setCofounderRepoForTests } from '@/server/cofounder/repo';

const stored = vi.hoisted(() => ({ pdfs: [] as Buffer[] }));
vi.mock('@/server/consultant-contracts/storage', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@/server/consultant-contracts/storage')),
  storeSignedContractPdf: vi.fn(async (pdf: Buffer) => {
    stored.pdfs.push(pdf);
    return { publicId: 'metwork/consultant-contracts/x', hash: 'h'.repeat(64), url: 'https://x', bytes: pdf.length };
  }),
}));

const { setSprintItem, sprintFor } = await import('@/server/cofounder/sprint');
const A = await import('@/server/cofounder/agreement');

const T0 = '2026-01-01T10:00:00.000Z';
const SIGNATURE = `data:image/png;base64,${readFileSync('public/apple-touch-icon.png').toString('base64')}`;
const cofounder = createMemoryCofounderRepo();

const user = (id: string) => ({
  id, email: `${id}@x.dz`, fullName: `Name ${id}`, phone: '+213550000001', city: 'algiers', role: 'ENTREPRENEUR', status: 'ACTIVE',
  passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
  avatarUrl: null, locale: 'fr', createdAt: T0, updatedAt: T0,
}) as never;

const ID_A = { legalName: 'Yasmine Belkacem', idNumber: '109876543', birthDate: '1994-03-02', address: '12 rue Didouche Mourad, Alger' };
const ID_B = { legalName: 'Karim Haddad', idNumber: '108765432', birthDate: '1991-07-21', address: '4 boulevard de la Soummam, Oran' };

let matchId = '';
const [ua, ub] = ['a-1', 'b-1'];

beforeEach(async () => {
  cofounder.reset();
  stored.pdfs = [];
  setCofounderRepoForTests(cofounder);
  matchId = (await cofounder.match(ua, ub)).id;
  await db.update((d) => {
    d.users = [user(ua), user(ub), user('x-1')];
    d.cofounderSprints = [];
    d.cofounderAgreements = [];
  });
});

const terms = (over: Record<string, unknown> = {}) => ({
  projectName: 'Fellah Connect',
  projectDescription: 'Relier les coopératives agricoles aux restaurants.',
  roles: { [ua]: 'CTO', [ub]: 'CEO' },
  commitments: { [ua]: 'FULL_TIME', [ub]: 'FULL_TIME' },
  equity: { [ua]: 45, [ub]: 45 },
  reservePercent: 10,
  vestingMonths: 48,
  cliffMonths: 12,
  jurisdiction: 'algiers',
  ...over,
});

async function readyAgreement() {
  const c = await A.createAgreement(ua, matchId);
  if (!c.ok) throw new Error(c.reason);
  const id = c.value.id;
  expect((await A.updateTerms(ub, id, terms())).ok).toBe(true);
  expect((await A.updateIdentity(ua, id, ID_A)).ok).toBe(true);
  expect((await A.updateIdentity(ub, id, ID_B)).ok).toBe(true);
  const sent = await A.sendToSignature(ua, id);
  if (!sent.ok) throw new Error(sent.reason);
  return sent.value;
}

async function signAs(userId: string, id: string) {
  const c = await A.sendSigningCode(userId, id);
  if (!c.ok) throw new Error(c.reason);
  return A.sign(userId, id, SIGNATURE, c.code);
}

describe('trial sprint', () => {
  it('is shared by the two founders only', async () => {
    expect(await sprintFor('x-1', matchId)).toBe('NOT_FOUND');
    expect(await setSprintItem('x-1', matchId, 'meet', true)).toBeNull();
    const s = await setSprintItem(ua, matchId, 'meet', true);
    expect(s!.done.meet!.by).toBe(ua);
    await setSprintItem(ub, matchId, 'meet', false);
    expect(Object.keys((await sprintFor(ua, matchId) as { done: object }).done)).toEqual([]);
  });
});

describe('agreement', () => {
  it('one live agreement per match, only for its founders', async () => {
    expect(await A.createAgreement('x-1', matchId)).toEqual({ ok: false, reason: 'NOT_FOUND' });
    const c = await A.createAgreement(ua, matchId);
    expect(c.ok && c.value.terms).toMatchObject({ vestingMonths: 48, cliffMonths: 12, equity: { [ua]: 50, [ub]: 50 } });
    expect(await A.createAgreement(ub, matchId)).toEqual({ ok: false, reason: 'EXISTS' });
    if (c.ok) expect(await A.updateTerms('x-1', c.value.id, terms())).toEqual({ ok: false, reason: 'NOT_FOUND' });
  });

  it('validates the terms', () => {
    const p: [string, string] = [ua, ub];
    expect(A.validTerms(terms(), p)).not.toBeNull();
    expect(A.validTerms(terms({ reservePercent: 0 }), p)).toBeNull(); // 90 %
    expect(A.validTerms(terms({ cliffMonths: 48 }), p)).toBeNull(); // cliff ≥ vesting
    expect(A.validTerms(terms({ vestingMonths: 6, cliffMonths: 0 }), p)).toBeNull();
    expect(A.validTerms(terms({ equity: { [ua]: 90, [ub]: 0 } }), p)).toBeNull();
  });

  it('each founder writes only their own identity; sending needs both', async () => {
    const c = await A.createAgreement(ua, matchId);
    const id = c.ok ? c.value.id : '';
    await A.updateTerms(ua, id, terms());
    await A.updateIdentity(ua, id, ID_A);
    const d = (await db.read()).cofounderAgreements![0]!;
    expect(d.identities[ua]).toEqual(ID_A);
    expect(d.identities[ub]).toBeNull();
    expect(await A.sendToSignature(ua, id)).toEqual({ ok: false, reason: 'INCOMPLETE' });
  });

  it('freezes the text at signature and locks it after the first signature', async () => {
    const a = await readyAgreement();
    expect(a.status).toBe('PENDING_SIGNATURES');
    expect(a.contentSnapshot).toContain('Yasmine Belkacem 45 %');
    expect(a.contentSnapshot).toContain('sur 48 mois');
    expect(a.contentSnapshot).toContain('10 % réservés');
    expect(await A.updateTerms(ua, a.id, terms())).toEqual({ ok: false, reason: 'NOT_DRAFT' });
    expect((await signAs(ua, a.id)).ok).toBe(true);
    expect(await A.reopen(ub, a.id)).toEqual({ ok: false, reason: 'SIGNED_BY_OTHER' });
  });

  it('needs a drawn signature and the signer\'s own valid code', async () => {
    const a = await readyAgreement();
    const c = await A.sendSigningCode(ua, a.id);
    if (!c.ok) throw new Error('code');
    expect(await A.sign(ua, a.id, 'data:image/png;base64,AAAA', c.code)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await A.sign(ua, a.id, SIGNATURE, c.code === '000000' ? '111111' : '000000')).toEqual({ ok: false, reason: 'INVALID' });
    // B cannot use A's code.
    expect(await A.sign(ub, a.id, SIGNATURE, c.code)).toMatchObject({ ok: false });
    expect((await A.sign(ua, a.id, SIGNATURE, c.code)).ok).toBe(true);
    expect(await A.sendSigningCode(ua, a.id)).toEqual({ ok: false, reason: 'ALREADY_SIGNED' });
  });

  it('the second signature renders and stores the PDF, then nothing changes', async () => {
    const a = await readyAgreement();
    await signAs(ua, a.id);
    const done = await signAs(ub, a.id);
    expect(done.ok && done.value).toMatchObject({ status: 'SIGNED', finalPdfHash: 'h'.repeat(64) });
    expect(stored.pdfs).toHaveLength(1);
    expect(stored.pdfs[0]!.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await A.cancel(ua, a.id)).toEqual({ ok: false, reason: 'ALREADY_SIGNED' });
    expect(await A.updateIdentity(ub, a.id, ID_B)).toEqual({ ok: false, reason: 'ALREADY_SIGNED' });
    // The view never carries signature images.
    const view = A.agreementView((await db.read()).cofounderAgreements![0]!, ua);
    expect(JSON.stringify(view)).not.toContain('base64');
  });

  it('cancelling before both signed discards the signatures', async () => {
    const a = await readyAgreement();
    await signAs(ua, a.id);
    expect((await A.cancel(ub, a.id)).ok).toBe(true);
    const d = (await db.read()).cofounderAgreements![0]!;
    expect(d).toMatchObject({ status: 'CANCELLED', signatures: {} });
    // A new one can start.
    expect((await A.createAgreement(ub, matchId)).ok).toBe(true);
  });
});
