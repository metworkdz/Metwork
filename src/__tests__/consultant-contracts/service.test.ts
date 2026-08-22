/**
 * Unit tests for the consultant contract service
 * (src/server/consultant-contracts/{service,otp}.ts).
 *
 * These records are tax evidence, so the tests pin the properties that make
 * them evidentiary rather than merely present:
 *   • snapshots frozen at send-time survive a later profile edit,
 *   • a SIGNED record refuses every content mutation at the data layer,
 *   • the audit trail is append-only in every status,
 *   • the OTP shares the platform's one implementation and cannot collide
 *     with a login code,
 *   • lockout and resend throttling are enforced in the service, not the route.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { db, type ConsultantContractRecord, type IncubatorRecord, type MentorRecord, type UserRecord } from '@/server/db/store';
import {
  createDraftContract,
  editDraftContract,
  sendContract,
  voidContract,
  sendSigningOtp,
  verifySigningOtp,
  updateContract,
  appendContractAudit,
  findContractById,
  findPendingContractForConsultant,
  describePayoutAccount,
} from '@/server/consultant-contracts/service';
import {
  contractOtpKey,
  evaluateSendPolicy,
  initialOtpState,
  nextStateAfterSend,
  nextStateAfterLockout,
  CONTRACT_OTP_TTL_MINUTES,
  CONTRACT_OTP_MAX_SENDS,
} from '@/server/consultant-contracts/otp';
import { issueOtp, verifyOtp } from '@/server/auth/otp';

const ADMIN_ID = 'admin-1';
const MENTOR_ID = 'mentor-1';

const MENTOR: MentorRecord = {
  id: MENTOR_ID,
  fullName: 'Yasmine Belkacem',
  position: 'Expert-comptable',
  imageUrl: '',
  bio: null,
  linkedinUrl: null,
  email: 'yasmine@example.dz',
  phone: '+213770112233',
  phoneVerified: true,
  payoutAccount: { accountType: 'bank', accountNumber: '00799999001234567890', holderName: 'Yasmine Belkacem' },
  createdAt: new Date('2026-01-01').toISOString(),
};

/**
 * Metwork's own legal identity. `sendContract` refuses to issue a contract that
 * cannot name the company's commercial register number and tax identifier, so
 * every fixture that sends one has to seed this party.
 */
const METWORK = {
  id: 'inc-metwork',
  name: 'EURL METWORK',
  description: '',
  city: 'Oran',
  managerId: ADMIN_ID,
  status: 'ACTIVE',
  website: null,
  logoUrl: null,
  commercialRegNumber: '31/00-1234567 B 24',
  nif: '002431012345678',
  address: '12 rue des Frères Bouadou, Oran',
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-01').toISOString(),
} as unknown as IncubatorRecord;

async function seedMentor(overrides: Partial<MentorRecord> = {}): Promise<void> {
  await db.update((d) => {
    d.mentors = [{ ...MENTOR, ...overrides }];
    d.users = [{ id: ADMIN_ID, role: 'ADMIN', email: 'admin@metwork.dz' } as UserRecord];
    d.incubators = [{ ...METWORK }];
  });
}

async function makeSentContract(): Promise<ConsultantContractRecord> {
  const draft = await createDraftContract({
    consultantId: MENTOR_ID,
    contentSnapshot: 'Mandat de recouvrement — EURL METWORK.',
    payoutMethod: 'BANK_TRANSFER',
    actorId: ADMIN_ID,
  });
  const sent = await sendContract(draft.id, ADMIN_ID);
  expect(sent.ok).toBe(true);
  return (sent as { ok: true; contract: ConsultantContractRecord }).contract;
}

beforeEach(async () => {
  await seedMentor();
});

/* ─────────────────── Creation & draft editing ─────────────────── */

describe('draft lifecycle', () => {
  it('creates a DRAFT with an unfrozen commission rate and a CREATED audit entry', async () => {
    const c = await createDraftContract({
      consultantId: MENTOR_ID,
      contentSnapshot: 'Projet de contrat.',
      payoutMethod: 'BANK_TRANSFER',
      actorId: ADMIN_ID,
    });

    expect(c.status).toBe('DRAFT');
    // Deliberately 0 until send-time: a draft must not carry a rate that could
    // go stale before the consultant ever sees it.
    expect(c.commissionRate).toBe(0);
    expect(c.signerPhoneSnapshot).toBe('');
    expect(c.auditTrail).toHaveLength(1);
    expect(c.auditTrail[0]?.event).toBe('CREATED');
  });

  it('allows editing while DRAFT and bumps templateVersion', async () => {
    const c = await createDraftContract({
      consultantId: MENTOR_ID,
      contentSnapshot: 'v1',
      payoutMethod: 'BANK_TRANSFER',
      actorId: ADMIN_ID,
    });

    const edited = await editDraftContract(c.id, { contentSnapshot: 'v2', payoutMethod: 'CHEQUE' });
    expect(edited.ok).toBe(true);
    expect((edited as { ok: true; contract: ConsultantContractRecord }).contract.contentSnapshot).toBe('v2');
    expect((edited as { ok: true; contract: ConsultantContractRecord }).contract.templateVersion).toBe(2);
  });

  it('refuses to edit a contract that has already been sent', async () => {
    const sent = await makeSentContract();
    const edited = await editDraftContract(sent.id, { contentSnapshot: 'sneaky rewrite' });

    expect(edited).toEqual({ ok: false, reason: 'NOT_DRAFT' });
    const fresh = await findContractById(sent.id);
    expect(fresh?.contentSnapshot).toBe('Mandat de recouvrement — EURL METWORK.');
  });
});

/* ─────────────────── Send-time snapshot freezing ─────────────────── */

describe('frozen snapshots', () => {
  it('freezes the commission rate from the canonical resolver, not a hardcoded constant', async () => {
    const sent = await makeSentContract();
    // Seeded default for MENTOR_CONSULTATION.
    expect(sent.commissionRate).toBe(0.2);

    // An admin lowering the live rule must not rewrite an issued contract.
    await db.update((d) => {
      d.commissionRules = [
        {
          id: 'rule_mentor_consultation',
          name: 'Mentor consultation commission',
          transactionType: 'MENTOR_CONSULTATION',
          rate: 0.05,
          description: '',
          isActive: true,
          updatedAt: new Date().toISOString(),
        },
      ];
    });

    const fresh = await findContractById(sent.id);
    expect(fresh?.commissionRate).toBe(0.2);
  });

  it('freezes the phone and payout details against a later profile edit', async () => {
    const sent = await makeSentContract();
    expect(sent.signerPhoneSnapshot).toBe('+213770112233');
    expect(sent.payoutDetails).toContain('7890');

    await db.update((d) => {
      const m = d.mentors[0]!;
      m.phone = '+213555999888';
      m.payoutAccount = { accountType: 'ccp', accountNumber: '11112222333344445555', holderName: 'Someone Else' };
    });

    const fresh = await findContractById(sent.id);
    expect(fresh?.signerPhoneSnapshot).toBe('+213770112233');
    expect(fresh?.payoutDetails).toContain('7890');
    expect(fresh?.payoutDetails).not.toContain('Someone Else');
  });

  it('masks all but the last four digits of the payout account', () => {
    const described = describePayoutAccount(MENTOR);
    expect(described).toBe('RIB ••••••••••••••••7890 — Yasmine Belkacem');
    expect(described).not.toContain('0079');
  });

  it('refuses to send when the consultant has no verified phone', async () => {
    await seedMentor({ phoneVerified: false });
    const draft = await createDraftContract({
      consultantId: MENTOR_ID,
      contentSnapshot: 'x',
      payoutMethod: 'BANK_TRANSFER',
      actorId: ADMIN_ID,
    });

    expect(await sendContract(draft.id, ADMIN_ID)).toEqual({ ok: false, reason: 'NO_VERIFIED_PHONE' });
  });
});

/* ─────────────────── Immutability after signing ─────────────────── */

describe('immutability', () => {
  async function makeSigned(): Promise<ConsultantContractRecord> {
    const sent = await makeSentContract();
    // Reach past the service on purpose: Phase 1 has no signing step yet, and
    // the point of the test is that the GATEWAY refuses writes regardless of
    // how the record reached SIGNED.
    await db.update((d) => {
      const c = d.consultantContracts!.find((x) => x.id === sent.id)!;
      c.status = 'SIGNED';
      c.signedAt = new Date().toISOString();
      c.finalPdfHash = 'a'.repeat(64);
      c.finalPdfPublicId = 'metwork/contracts/x';
    });
    return (await findContractById(sent.id))!;
  }

  it.each([
    ['contentSnapshot', (c: ConsultantContractRecord) => { c.contentSnapshot = 'rewritten'; }],
    ['commissionRate', (c: ConsultantContractRecord) => { c.commissionRate = 0.01; }],
    ['payoutMethod', (c: ConsultantContractRecord) => { c.payoutMethod = 'CHEQUE'; }],
    ['finalPdfHash', (c: ConsultantContractRecord) => { c.finalPdfHash = 'b'.repeat(64); }],
    ['signature', (c: ConsultantContractRecord) => { c.signature = { imagePng: 'forged', signedAt: '2020-01-01' }; }],
    ['status', (c: ConsultantContractRecord) => { c.status = 'DRAFT'; }],
  ])('rejects a write to %s on a SIGNED contract', async (field, mutate) => {
    const signed = await makeSigned();
    const result = await updateContract(signed.id, mutate);

    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe('IMMUTABLE');

    // A rejected mutation must not half-apply.
    const fresh = await findContractById(signed.id);
    expect(fresh).toEqual(signed);
    expect(field).toBeTruthy();
  });

  it('still allows appending to the audit trail after signing', async () => {
    const signed = await makeSigned();
    const after = await appendContractAudit(signed.id, 'VIEWED', MENTOR_ID);

    expect(after).not.toBeNull();
    expect(after!.auditTrail.at(-1)?.event).toBe('VIEWED');
    expect(after!.auditTrail.length).toBe(signed.auditTrail.length + 1);
  });

  it('allows re-minting the expiring signed PDF url but never its hash or public id', async () => {
    const signed = await makeSigned();

    const refresh = await updateContract(signed.id, (c) => { c.finalPdfUrl = 'https://res.cloudinary.com/fresh'; });
    expect(refresh.ok).toBe(true);

    const repoint = await updateContract(signed.id, (c) => { c.finalPdfPublicId = 'metwork/contracts/other'; });
    expect(repoint.ok).toBe(false);
  });

  it('rejects truncating or rewriting existing audit entries in any status', async () => {
    const sent = await makeSentContract(); // PENDING_SIGNATURE — otherwise mutable

    const truncate = await updateContract(sent.id, (c) => { c.auditTrail = []; });
    expect(truncate).toMatchObject({ ok: false, reason: 'IMMUTABLE' });

    const rewrite = await updateContract(sent.id, (c) => { c.auditTrail[0]!.actorId = 'someone-else'; });
    expect(rewrite).toMatchObject({ ok: false, reason: 'IMMUTABLE' });
  });

  it('makes a VOIDED contract fully terminal', async () => {
    const sent = await makeSentContract();
    const voided = await voidContract(sent.id, ADMIN_ID, { confirm: true });
    expect(voided.ok).toBe(true);

    const revive = await updateContract(sent.id, (c) => { c.status = 'PENDING_SIGNATURE'; });
    expect(revive).toMatchObject({ ok: false, reason: 'IMMUTABLE' });
  });
});

/* ─────────────────── Void confirmation gate ─────────────────── */

describe('voiding', () => {
  it('refuses without an explicit server-side confirmation', async () => {
    const sent = await makeSentContract();
    expect(await voidContract(sent.id, ADMIN_ID, { confirm: false })).toEqual({
      ok: false,
      reason: 'NOT_CONFIRMED',
    });
    expect((await findContractById(sent.id))?.status).toBe('PENDING_SIGNATURE');
  });

  it('cannot void a signed contract', async () => {
    const sent = await makeSentContract();
    await db.update((d) => {
      d.consultantContracts!.find((x) => x.id === sent.id)!.status = 'SIGNED';
    });
    expect(await voidContract(sent.id, ADMIN_ID, { confirm: true })).toEqual({
      ok: false,
      reason: 'NOT_PENDING',
    });
  });

  it('clears the OTP state so an in-flight code cannot be redeemed', async () => {
    const sent = await makeSentContract();
    await sendSigningOtp(sent.id, MENTOR_ID);
    await voidContract(sent.id, ADMIN_ID, { confirm: true });

    const fresh = await findContractById(sent.id);
    expect(fresh?.otp).toBeNull();
    expect(await findPendingContractForConsultant(MENTOR_ID)).toBeNull();
  });
});

/* ─────────────────── OTP: shared implementation, isolated namespace ─────────────────── */

describe('signing OTP', () => {
  it('issues a 5-minute code through the shared OTP table', async () => {
    const sent = await makeSentContract();
    const before = Date.now();
    const result = await sendSigningOtp(sent.id, MENTOR_ID);

    expect(result.ok).toBe(true);
    const issued = result as { ok: true; code: string; expiresAt: string };
    expect(issued.code).toMatch(/^\d{6}$/);

    const ttlMs = new Date(issued.expiresAt).getTime() - before;
    expect(ttlMs).toBeGreaterThan((CONTRACT_OTP_TTL_MINUTES - 1) * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(CONTRACT_OTP_TTL_MINUTES * 60_000 + 1_000);

    // The code lives in the one shared table, under the contract namespace —
    // not in a parallel store on the contract record.
    const data = await db.read();
    expect(data.otps.some((o) => o.userId === contractOtpKey(sent.id))).toBe(true);
    const stored = data.consultantContracts![0]!;
    expect(Object.keys(stored.otp!)).not.toContain('codeHash');
  });

  it('does not collide with a login OTP for the same person', async () => {
    const sent = await makeSentContract();

    const login = await issueOtp('user-42');
    const signing = await sendSigningOtp(sent.id, MENTOR_ID);
    expect(signing.ok).toBe(true);

    // Issuing the contract code must not have invalidated the login code.
    expect(await verifyOtp('user-42', login.code)).toEqual({ ok: true });

    // And the login code must not satisfy the contract.
    const wrong = await verifySigningOtp(sent.id, login.code, MENTOR_ID);
    expect(wrong.ok).toBe(false);
  });

  it('verifies a correct code and records OTP_VERIFIED without flipping to SIGNED', async () => {
    const sent = await makeSentContract();
    const issued = (await sendSigningOtp(sent.id, MENTOR_ID)) as { ok: true; code: string };

    const verified = await verifySigningOtp(sent.id, issued.code, MENTOR_ID);
    expect(verified.ok).toBe(true);

    const fresh = await findContractById(sent.id);
    // Phase 1 proves identity only — the SIGNED transition needs the PDF,
    // its hash and its stored location to land together (Phase 2).
    expect(fresh?.status).toBe('PENDING_SIGNATURE');
    expect(fresh?.auditTrail.at(-1)?.event).toBe('OTP_VERIFIED');
  });

  it('records every failed attempt and locks out after the fifth', async () => {
    const sent = await makeSentContract();
    await sendSigningOtp(sent.id, MENTOR_ID);

    // The shared module spends all 5 attempts first and reports exhaustion on
    // the call that follows — the consultant genuinely gets 5 guesses.
    for (let i = 0; i < 5; i++) {
      expect(await verifySigningOtp(sent.id, '000000', MENTOR_ID)).toEqual({ ok: false, reason: 'INVALID' });
    }
    expect(await verifySigningOtp(sent.id, '000000', MENTOR_ID)).toEqual({
      ok: false,
      reason: 'TOO_MANY_ATTEMPTS',
    });

    const fresh = await findContractById(sent.id);
    expect(fresh?.otp?.lockedUntil).not.toBeNull();
    expect(new Date(fresh!.otp!.lockedUntil!).getTime()).toBeGreaterThan(Date.now());
    expect(fresh?.auditTrail.filter((e) => e.event === 'OTP_FAILED')).toHaveLength(6);

    // Subsequent attempts are refused by the service before touching the code.
    expect(await verifySigningOtp(sent.id, '000000', MENTOR_ID)).toEqual({ ok: false, reason: 'LOCKED' });
  });

  it('refuses to send or verify against a contract that is not awaiting signature', async () => {
    const draft = await createDraftContract({
      consultantId: MENTOR_ID,
      contentSnapshot: 'x',
      payoutMethod: 'CHEQUE',
      actorId: ADMIN_ID,
    });
    expect(await sendSigningOtp(draft.id, MENTOR_ID)).toEqual({ ok: false, reason: 'NOT_PENDING' });
    expect(await verifySigningOtp(draft.id, '123456', MENTOR_ID)).toEqual({ ok: false, reason: 'NOT_PENDING' });
  });

  it('labels the first send OTP_SENT and later ones RESEND_OTP', async () => {
    const sent = await makeSentContract();
    await sendSigningOtp(sent.id, MENTOR_ID);

    // Step past the escalating minimum interval without waiting for it.
    await db.update((d) => {
      d.consultantContracts![0]!.otp!.lastSentAt = new Date(Date.now() - 10 * 60_000).toISOString();
    });
    await sendSigningOtp(sent.id, MENTOR_ID);

    const fresh = await findContractById(sent.id);
    const events = fresh!.auditTrail.map((e) => e.event);
    expect(events).toContain('OTP_SENT');
    expect(events).toContain('RESEND_OTP');
  });
});

/* ─────────────────── Resend throttle (pure policy) ─────────────────── */

describe('resend policy', () => {
  const T0 = new Date('2026-08-21T10:00:00Z').getTime();

  it('allows the first send and then enforces an escalating gap', () => {
    expect(evaluateSendPolicy(null, T0)).toEqual({ allowed: true });

    const afterFirst = nextStateAfterSend(initialOtpState(), T0);
    expect(evaluateSendPolicy(afterFirst, T0 + 5_000)).toMatchObject({ allowed: false, reason: 'TOO_SOON' });
    expect(evaluateSendPolicy(afterFirst, T0 + 31_000)).toEqual({ allowed: true });

    const afterSecond = nextStateAfterSend(afterFirst, T0 + 31_000);
    // Second gap is longer than the first — that is the backoff.
    expect(evaluateSendPolicy(afterSecond, T0 + 91_000)).toMatchObject({ allowed: false, reason: 'TOO_SOON' });
    expect(evaluateSendPolicy(afterSecond, T0 + 160_000)).toEqual({ allowed: true });
  });

  it('caps sends per rolling hour and reopens once the window lapses', () => {
    let state = initialOtpState();
    let t = T0;
    for (let i = 0; i < CONTRACT_OTP_MAX_SENDS; i++) {
      expect(evaluateSendPolicy(state, t).allowed).toBe(true);
      state = nextStateAfterSend(state, t);
      t += 5 * 60_000;
    }

    expect(evaluateSendPolicy(state, t)).toMatchObject({ allowed: false, reason: 'TOO_MANY_SENDS' });
    // Still capped just before the window closes, open again just after.
    expect(evaluateSendPolicy(state, T0 + 59 * 60_000)).toMatchObject({ allowed: false });
    expect(evaluateSendPolicy(state, T0 + 61 * 60_000)).toEqual({ allowed: true });
  });

  it('refuses sends while locked out, and a lockout does not reset the send cap', () => {
    let state = nextStateAfterSend(initialOtpState(), T0);
    state = nextStateAfterSend(state, T0 + 60_000);
    state = nextStateAfterSend(state, T0 + 180_000);
    const locked = nextStateAfterLockout(state, T0 + 200_000);

    expect(evaluateSendPolicy(locked, T0 + 300_000)).toMatchObject({ allowed: false, reason: 'LOCKED' });
    expect(locked.sendCount).toBe(CONTRACT_OTP_MAX_SENDS);
    expect(locked.windowStartedAt).toBe(state.windowStartedAt);
  });
});

/* ─────────────────── Legacy documents ─────────────────── */

describe('additive schema', () => {
  it('reads a document that predates the collection as empty', async () => {
    await db.update((d) => {
      delete (d as { consultantContracts?: unknown }).consultantContracts;
    });
    expect(await findPendingContractForConsultant(MENTOR_ID)).toBeNull();

    // And a write against that document still works.
    const c = await createDraftContract({
      consultantId: MENTOR_ID,
      contentSnapshot: 'x',
      payoutMethod: 'CHEQUE',
      actorId: ADMIN_ID,
    });
    expect(await findContractById(c.id)).not.toBeNull();
  });
});
