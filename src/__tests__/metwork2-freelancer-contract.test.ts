/**
 * Metwork 2.0 phase E — the freelancer's contract with Metwork: offered at
 * 100 % profile (once, with a notification), signed with CIN + drawing + a
 * code to the freelancer's own phone, frozen afterwards, and required (with a
 * complete profile) before any withdrawal.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const otp = vi.hoisted(() => ({ issue: vi.fn(), verify: vi.fn() }));
vi.mock('@/server/auth/otp', () => ({ issueOtp: otp.issue, verifyOtp: otp.verify }));
vi.mock('@/server/consultant-contracts/storage', () => ({
  storeSignedContractPdf: vi.fn(async () => ({ publicId: 'contracts/f-1', hash: 'abc123', url: 'https://x' })),
  fetchContractPdfBytes: vi.fn(async () => Buffer.from('%PDF')),
}));
const pdf = vi.hoisted(() => ({ gen: vi.fn(async () => Buffer.from('%PDF-1.7')) }));
vi.mock('@/server/consultant-contracts/contract-pdf', () => ({ generateConsultantContractPdf: pdf.gen }));

import { db } from '@/server/db/store';
import {
  currentContract,
  offerContractIfEligible,
  sendSigningCode,
  signContract,
  withdrawalBlock,
} from '@/server/freelancer-contracts/service';
import { createWithdrawalRequest } from '@/server/withdrawals/service';
import { FREELANCER_CONTRACT_DEFAULT } from '@/lib/freelancer-contract-text';

const T0 = '2026-01-01T10:00:00.000Z';
// A drawn signature well above the 256-byte floor.
const SIG = `data:image/png;base64,${Buffer.alloc(600, 7).toString('base64')}`;

function freelancer(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, email: `${id}@x.dz`, fullName: 'Amine Kaci', phone: '+213550000001', city: 'alger', role: 'FREELANCER', status: 'ACTIVE',
    passwordHash: 'x', phoneVerified: true, emailVerified: true, membershipCode: null, membershipTier: 'EXPLORER',
    avatarUrl: 'https://res.cloudinary.com/x/a.png', locale: 'fr', createdAt: T0, updatedAt: T0,
    payoutAccount: { accountType: 'bank', accountNumber: '00799999000123456789', holderName: 'Amine Kaci' },
    legalVerificationStatus: 'APPROVED',
    ...extra,
  } as never;
}

function completeProfile(userId: string) {
  return {
    userId, headline: 'Développeur web', bio: 'x'.repeat(90), skills: ['react', 'node', 'figma'],
    address: '12 rue Didouche Mourad', portfolio: [{}, {}], createdAt: T0, updatedAt: T0,
    legal: { extracted: { documentNumber: 'AE-16-0042' } },
  } as never;
}

beforeEach(async () => {
  otp.issue.mockReset().mockResolvedValue({ code: '123456', expiresAt: T0 });
  otp.verify.mockReset().mockResolvedValue({ ok: true });
  pdf.gen.mockClear();
  await db.update((d) => {
    d.users = [freelancer('fl-1'), freelancer('fl-2'), freelancer('ent-1', { role: 'ENTREPRENEUR' })];
    d.freelancerProfiles = [completeProfile('fl-1')];
    d.freelancerContracts = [];
    d.notifications = [];
    d.withdrawalRequests = [];
    d.wallets = [
      { id: 'w1', userId: 'fl-1', balance: 50_000, currency: 'DZD', status: 'ACTIVE', createdAt: T0, updatedAt: T0 },
      { id: 'w3', userId: 'ent-1', balance: 50_000, currency: 'DZD', status: 'ACTIVE', createdAt: T0, updatedAt: T0 },
    ] as never;
    d.transactions = [];
  });
});

describe('text', () => {
  it('is the consultant contract for freelancers, with both plans quoted', () => {
    expect(FREELANCER_CONTRACT_DEFAULT).not.toMatch(/Consultant/);
    expect(FREELANCER_CONTRACT_DEFAULT).toContain('le Freelancer');
    expect(FREELANCER_CONTRACT_DEFAULT).toContain('{{mission_rate_premium}}');
    expect(FREELANCER_CONTRACT_DEFAULT).toContain('Article 14');
  });
});

describe('offer', () => {
  it('offers once at 100 %, renders the terms, notifies the freelancer', async () => {
    expect(await offerContractIfEligible('fl-2')).toBe(false); // no profile: below 100 %
    expect(await offerContractIfEligible('ent-1')).toBe(false); // not a freelancer
    expect(await offerContractIfEligible('fl-1')).toBe(true);
    expect(await offerContractIfEligible('fl-1')).toBe(false);
    const d = await db.read();
    const c = currentContract(d, 'fl-1')!;
    expect(c.status).toBe('PENDING_SIGNATURE');
    expect(c.rates).toEqual({ sourcedFree: 10, sourcedPremium: 7, linkFree: 3, linkPremium: 0 });
    expect(c.contentSnapshot).toContain('M./Mme Amine Kaci');
    expect(c.contentSnapshot).toContain('10 % avec l\'offre gratuite, 7 % avec l\'offre Premium');
    expect(c.contentSnapshot).toContain('3 % avec l\'offre gratuite, 0 % avec l\'offre Premium');
    expect(c.contentSnapshot).toContain('12 rue Didouche Mourad');
    expect(c.contentSnapshot).toContain("carte d'auto-entrepreneur n° AE-16-0042");
    // Only the CIN is left to fill.
    expect(c.contentSnapshot.match(/\{\{[a-z_]+\}\}/g)).toEqual(['{{freelancer_id_number}}']);
    expect(d.notifications.filter((n) => n.userId === 'fl-1')).toEqual([expect.objectContaining({ href: '/dashboard/freelancer/contract' })]);
  });
});

describe('sign', () => {
  async function pending() {
    await offerContractIfEligible('fl-1');
    return currentContract(await db.read(), 'fl-1')!;
  }

  it('freezes the CIN into the text and stores the PDF', async () => {
    const c = await pending();
    expect((await sendSigningCode('fl-1', c.id)).ok).toBe(true);
    const r = await signContract('fl-1', c.id, { signaturePng: SIG, code: '123456', idNumber: '1099 9000 1234 5678 9' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe('SIGNED');
    expect(r.value.idNumber).toBe('10999000123456789');
    expect(r.value.contentSnapshot).toContain('n° 10999000123456789');
    expect(r.value.contentSnapshot).not.toContain('{{');
    expect(r.value.finalPdfHash).toBe('abc123');
    expect(pdf.gen).toHaveBeenCalledWith(expect.objectContaining({ signerLabel: 'Freelancer', titleSubtitle: 'ENTRE METWORK ET LE FREELANCER', consultantName: 'Amine Kaci' }));
  });

  it('checks the drawing and the CIN before spending the code', async () => {
    const c = await pending();
    expect(await signContract('fl-1', c.id, { signaturePng: 'data:image/png;base64,AAAA', code: '123456', idNumber: '109990001' })).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(await signContract('fl-1', c.id, { signaturePng: SIG, code: '123456', idNumber: '12AB' })).toEqual({ ok: false, reason: 'BAD_ID_NUMBER' });
    expect(otp.verify).not.toHaveBeenCalled();
  });

  it('refuses a wrong code, someone else’s contract, and a second signature', async () => {
    const c = await pending();
    otp.verify.mockResolvedValueOnce({ ok: false, reason: 'INVALID' });
    expect(await signContract('fl-1', c.id, { signaturePng: SIG, code: '000000', idNumber: '109990001' })).toEqual({ ok: false, reason: 'INVALID' });
    expect(await signContract('fl-2', c.id, { signaturePng: SIG, code: '123456', idNumber: '109990001' })).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect((await signContract('fl-1', c.id, { signaturePng: SIG, code: '123456', idNumber: '109990001' })).ok).toBe(true);
    expect(await signContract('fl-1', c.id, { signaturePng: SIG, code: '123456', idNumber: '999999999' })).toEqual({ ok: false, reason: 'NOT_PENDING' });
    expect((await sendSigningCode('fl-1', c.id)).ok).toBe(false);
  });
});

describe('withdrawal gate', () => {
  it('blocks an incomplete profile, then an unsigned contract, then lets it through', async () => {
    await db.update((d) => { d.freelancerProfiles = []; });
    let d = await db.read();
    expect(withdrawalBlock(d, d.users[0]!)).toBe('PROFILE_INCOMPLETE');
    expect(await createWithdrawalRequest({ targetType: 'user', targetId: 'fl-1', amount: 5000, method: 'cheque' }))
      .toEqual({ ok: false, reason: 'FREELANCER_NOT_ELIGIBLE', block: 'PROFILE_INCOMPLETE' });

    await db.update((x) => { x.freelancerProfiles = [completeProfile('fl-1')]; });
    expect(await createWithdrawalRequest({ targetType: 'user', targetId: 'fl-1', amount: 5000, method: 'cheque' }))
      .toEqual({ ok: false, reason: 'FREELANCER_NOT_ELIGIBLE', block: 'CONTRACT_UNSIGNED' });
    expect((await db.read()).wallets.find((w) => w.userId === 'fl-1')!.balance).toBe(50_000);

    await offerContractIfEligible('fl-1');
    const c = currentContract(await db.read(), 'fl-1')!;
    await signContract('fl-1', c.id, { signaturePng: SIG, code: '123456', idNumber: '109990001' });
    d = await db.read();
    expect(withdrawalBlock(d, d.users[0]!)).toBeNull();
    expect((await createWithdrawalRequest({ targetType: 'user', targetId: 'fl-1', amount: 5000, method: 'cheque' })).ok).toBe(true);
  });

  it('leaves other roles alone', async () => {
    expect((await createWithdrawalRequest({ targetType: 'user', targetId: 'ent-1', amount: 5000, method: 'cheque' })).ok).toBe(true);
  });
});
