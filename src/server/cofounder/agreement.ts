/**
 * Cofounder agreements — THE single write path for `d.cofounderAgreements`.
 *
 * The same evidence rules as consultant contracts, for two signers:
 *   DRAFT               either founder edits the terms; each fills in ONLY
 *                       their own identity. Every edit bumps `version`.
 *   PENDING_SIGNATURES  the text is rendered and FROZEN (`contentSnapshot`).
 *                       Before anyone signs, either can reopen it as a draft;
 *                       after the first signature it can only be signed or
 *                       cancelled.
 *   SIGNED              both signed (drawn signature + one-time code to the
 *                       signer's own phone); the PDF is rendered from the
 *                       frozen text, hashed and stored privately. Immutable.
 *   CANCELLED           either founder, any time before SIGNED.
 *
 * Only the two founders of the match ever read or write an agreement.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type CofounderAgreementIdentity,
  type CofounderAgreementRecord,
  type CofounderAgreementTerms,
} from '@/server/db/store';
import { issueOtp, verifyOtp } from '@/server/auth/otp';
import { evaluateSendPolicy, isLockedOut, nextStateAfterLockout, nextStateAfterSend, type OtpSendDecision } from '@/server/consultant-contracts/otp';
import { storeSignedContractPdf } from '@/server/consultant-contracts/storage';
import { fetchContractPdfBytes } from '@/server/consultant-contracts/storage';
import { findCityCode } from '@/config/cities';
import { matchParties } from '@/server/cofounder/sprint';
import { renderAgreementText } from '@/server/cofounder/agreement-text';
import { generateAgreementPdf, maskPhone } from '@/server/cofounder/agreement-pdf';

const OTP_TTL_MINUTES = 5;
const MIN_SIGNATURE_BYTES = 256;
export const VESTING_RANGE = { min: 12, max: 60 } as const;
export const CLIFF_RANGE = { min: 0, max: 24 } as const;

const otpKey = (agreementId: string, userId: string) => `cofounder-agreement:${agreementId}:${userId}`;

export type AgreementError =
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'NOT_DRAFT'
  | 'NOT_PENDING'
  | 'INCOMPLETE'
  | 'INVALID_TERMS'
  | 'ALREADY_SIGNED'
  | 'SIGNED_BY_OTHER'
  | 'BAD_SIGNATURE'
  | 'LOCKED'
  | 'INVALID'
  | 'EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'NO_PHONE'
  | 'STORAGE_FAILED';

export type AgreementResult<T = CofounderAgreementRecord> = { ok: true; value: T } | { ok: false; reason: AgreementError };

const now = () => new Date().toISOString();
const ok = <T>(value: T): AgreementResult<T> => ({ ok: true, value });

function current(d: { cofounderAgreements?: CofounderAgreementRecord[] }, matchId: string): CofounderAgreementRecord | null {
  return (d.cofounderAgreements ?? []).filter((a) => a.matchId === matchId && a.status !== 'CANCELLED').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** The match's live agreement (not cancelled) for one of its founders, or null. */
export async function agreementFor(userId: string, matchId: string): Promise<CofounderAgreementRecord | null | 'NOT_FOUND'> {
  if (!(await matchParties(userId, matchId))) return 'NOT_FOUND';
  return current(await db.read(), matchId);
}

/** Validate terms for the two parties. Returns the cleaned terms or null. */
export function validTerms(t: CofounderAgreementTerms, parties: [string, string]): CofounderAgreementTerms | null {
  const equity = parties.map((p) => t.equity[p]);
  if (equity.some((e) => typeof e !== 'number' || !Number.isFinite(e) || e <= 0 || e > 100)) return null;
  if (!Number.isFinite(t.reservePercent) || t.reservePercent < 0 || t.reservePercent > 30) return null;
  const sum = Math.round((equity.reduce<number>((acc, e) => acc + (e ?? 0), 0) + t.reservePercent) * 100) / 100;
  if (sum !== 100) return null;
  if (!Number.isInteger(t.vestingMonths) || t.vestingMonths < VESTING_RANGE.min || t.vestingMonths > VESTING_RANGE.max) return null;
  if (!Number.isInteger(t.cliffMonths) || t.cliffMonths < CLIFF_RANGE.min || t.cliffMonths > CLIFF_RANGE.max || t.cliffMonths >= t.vestingMonths) return null;
  if (!findCityCode(t.jurisdiction)) return null;
  if (t.projectName.trim().length < 2 || t.projectDescription.trim().length < 10) return null;
  return {
    ...t,
    jurisdiction: findCityCode(t.jurisdiction)!,
    // Keep only the two parties' entries.
    roles: Object.fromEntries(parties.map((p) => [p, (t.roles[p] ?? '').trim()])),
    commitments: Object.fromEntries(parties.map((p) => [p, t.commitments[p] ?? ''])),
    equity: Object.fromEntries(parties.map((p) => [p, t.equity[p]!])),
  };
}

function defaultTerms(parties: [string, string]): CofounderAgreementTerms {
  return {
    projectName: '',
    projectDescription: '',
    roles: { [parties[0]]: '', [parties[1]]: '' },
    commitments: { [parties[0]]: 'FULL_TIME', [parties[1]]: 'FULL_TIME' },
    equity: { [parties[0]]: 50, [parties[1]]: 50 },
    reservePercent: 0,
    vestingMonths: 48,
    cliffMonths: 12,
    jurisdiction: 'algiers',
  };
}

/** Start a draft for a match — one live agreement per match. */
export async function createAgreement(userId: string, matchId: string): Promise<AgreementResult> {
  const parties = await matchParties(userId, matchId);
  if (!parties) return { ok: false, reason: 'NOT_FOUND' };
  return db.update<AgreementResult>((d) => {
    if (current(d, matchId)) return { ok: false, reason: 'EXISTS' };
    const at = now();
    const a: CofounderAgreementRecord = {
      id: randomUUID(),
      matchId,
      parties,
      status: 'DRAFT',
      terms: defaultTerms(parties),
      identities: { [parties[0]]: null, [parties[1]]: null },
      version: 1,
      contentSnapshot: null,
      signatures: {},
      otp: {},
      finalPdfPublicId: null,
      finalPdfHash: null,
      signedAt: null,
      auditTrail: [{ event: 'CREATED', actorId: userId, at }],
      createdAt: at,
      updatedAt: at,
    };
    (d.cofounderAgreements ??= []).push(a);
    return { ok: true, value: a };
  });
}

/**
 * Every write after creation goes through here: the agreement must exist,
 * the caller must be one of its founders, and a SIGNED agreement is never
 * passed to a mutator at all.
 */
async function mutate<T>(
  userId: string,
  agreementId: string,
  fn: (a: CofounderAgreementRecord) => AgreementResult<T>,
): Promise<AgreementResult<T>> {
  return db.update<AgreementResult<T>>((d) => {
    const a = (d.cofounderAgreements ?? []).find((x) => x.id === agreementId);
    if (!a || !a.parties.includes(userId)) return { ok: false, reason: 'NOT_FOUND' };
    if (a.status === 'SIGNED') return { ok: false, reason: 'ALREADY_SIGNED' };
    const out = fn(a);
    if (out.ok) a.updatedAt = now();
    return out;
  });
}

export async function updateTerms(userId: string, agreementId: string, terms: CofounderAgreementTerms): Promise<AgreementResult> {
  return mutate(userId, agreementId, (a) => {
    if (a.status !== 'DRAFT') return { ok: false, reason: 'NOT_DRAFT' };
    const clean = validTerms(terms, a.parties);
    if (!clean) return { ok: false, reason: 'INVALID_TERMS' };
    a.terms = clean;
    a.version += 1;
    a.auditTrail.push({ event: 'TERMS_EDITED', actorId: userId, at: now() });
    return ok({ ...a });
  });
}

/** Each founder fills in their own identity — never the other's. */
export async function updateIdentity(userId: string, agreementId: string, identity: CofounderAgreementIdentity): Promise<AgreementResult> {
  return mutate(userId, agreementId, (a) => {
    if (a.status !== 'DRAFT') return { ok: false, reason: 'NOT_DRAFT' };
    a.identities[userId] = { ...identity };
    a.version += 1;
    a.auditTrail.push({ event: 'IDENTITY_EDITED', actorId: userId, at: now() });
    return ok({ ...a });
  });
}

/** Freeze the text and open signatures. Both identities and valid terms are required. */
export async function sendToSignature(userId: string, agreementId: string): Promise<AgreementResult> {
  return mutate(userId, agreementId, (a) => {
    if (a.status !== 'DRAFT') return { ok: false, reason: 'NOT_DRAFT' };
    const [p0, p1] = a.parties;
    const i0 = a.identities[p0];
    const i1 = a.identities[p1];
    if (!i0 || !i1) return { ok: false, reason: 'INCOMPLETE' };
    if (!validTerms(a.terms, a.parties) || !a.terms.roles[p0] || !a.terms.roles[p1]) return { ok: false, reason: 'INVALID_TERMS' };
    a.contentSnapshot = renderAgreementText(a.terms, [{ userId: p0, identity: i0 }, { userId: p1, identity: i1 }]);
    a.status = 'PENDING_SIGNATURES';
    a.signatures = {};
    a.otp = {};
    a.auditTrail.push({ event: 'SENT_TO_SIGNATURE', actorId: userId, at: now() });
    return ok({ ...a });
  });
}

/** Back to draft — only while nobody has signed. */
export async function reopen(userId: string, agreementId: string): Promise<AgreementResult> {
  return mutate(userId, agreementId, (a) => {
    if (a.status !== 'PENDING_SIGNATURES') return { ok: false, reason: 'NOT_PENDING' };
    if (Object.keys(a.signatures).length > 0) return { ok: false, reason: 'SIGNED_BY_OTHER' };
    a.status = 'DRAFT';
    a.contentSnapshot = null;
    a.version += 1;
    a.auditTrail.push({ event: 'REOPENED', actorId: userId, at: now() });
    return ok({ ...a });
  });
}

export async function cancel(userId: string, agreementId: string): Promise<AgreementResult> {
  return mutate(userId, agreementId, (a) => {
    a.status = 'CANCELLED';
    // A cancelled agreement keeps no signature images.
    a.signatures = {};
    a.otp = {};
    a.auditTrail.push({ event: 'CANCELLED', actorId: userId, at: now() });
    return ok({ ...a });
  });
}

/* ─────────────────────────── Signing ─────────────────────────── */

export type SendCodeResult =
  | { ok: true; code: string; phone: string; expiresAt: string }
  | { ok: false; reason: AgreementError }
  | { ok: false; reason: 'THROTTLED'; detail: Extract<OtpSendDecision, { allowed: false }> };

/** Issue a signing code to the caller's own phone. Delivery is the route's job. */
export async function sendSigningCode(userId: string, agreementId: string): Promise<SendCodeResult> {
  const data = await db.read();
  const phone = data.users.find((u) => u.id === userId)?.phone?.trim();
  if (!phone) return { ok: false, reason: 'NO_PHONE' };
  const t = Date.now();
  const gate = await mutate<{ throttled: Extract<OtpSendDecision, { allowed: false }> } | null>(userId, agreementId, (a) => {
    if (a.status !== 'PENDING_SIGNATURES') return { ok: false, reason: 'NOT_PENDING' };
    if (a.signatures[userId]) return { ok: false, reason: 'ALREADY_SIGNED' };
    const decision = evaluateSendPolicy(a.otp[userId] ?? null, t);
    if (!decision.allowed) return ok({ throttled: decision });
    a.otp[userId] = nextStateAfterSend(a.otp[userId] ?? null, t);
    a.auditTrail.push({ event: 'OTP_SENT', actorId: userId, at: new Date(t).toISOString() });
    return ok(null);
  });
  if (!gate.ok) return gate;
  if (gate.value) return { ok: false, reason: 'THROTTLED', detail: gate.value.throttled };
  const { code, expiresAt } = await issueOtp(otpKey(agreementId, userId), { ttlMinutes: OTP_TTL_MINUTES });
  return { ok: true, code, phone, expiresAt };
}

function signatureBytes(dataUri: string): number {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri ?? '');
  return m?.[1] ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').length : 0;
}

/**
 * Sign: check the drawn signature, spend the code, record the signature.
 * The second signature completes the agreement (`finalize`).
 */
export async function sign(userId: string, agreementId: string, signaturePng: string, code: string): Promise<AgreementResult> {
  if (signatureBytes(signaturePng) < MIN_SIGNATURE_BYTES) return { ok: false, reason: 'BAD_SIGNATURE' };
  const data = await db.read();
  const a0 = (data.cofounderAgreements ?? []).find((x) => x.id === agreementId);
  if (!a0 || !a0.parties.includes(userId)) return { ok: false, reason: 'NOT_FOUND' };
  if (a0.status !== 'PENDING_SIGNATURES') return { ok: false, reason: 'NOT_PENDING' };
  if (a0.signatures[userId]) return { ok: false, reason: 'ALREADY_SIGNED' };
  if (isLockedOut(a0.otp[userId] ?? null, Date.now())) return { ok: false, reason: 'LOCKED' };

  const verified = await verifyOtp(otpKey(agreementId, userId), code);
  if (!verified.ok) {
    const t = Date.now();
    await mutate(userId, agreementId, (a) => {
      a.auditTrail.push({ event: 'OTP_FAILED', actorId: userId, at: new Date(t).toISOString() });
      if (verified.reason === 'TOO_MANY_ATTEMPTS') a.otp[userId] = nextStateAfterLockout(a.otp[userId] ?? null, t);
      return ok(null);
    });
    if (verified.reason === 'TOO_MANY_ATTEMPTS') return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    return { ok: false, reason: verified.reason === 'EXPIRED' ? 'EXPIRED' : 'INVALID' };
  }

  const phone = data.users.find((u) => u.id === userId)?.phone ?? '';
  const recorded = await mutate(userId, agreementId, (a) => {
    // The text cannot have changed: only PENDING agreements reach here, and
    // reopening is refused once anyone has signed.
    if (a.status !== 'PENDING_SIGNATURES') return { ok: false, reason: 'NOT_PENDING' };
    if (a.signatures[userId]) return { ok: false, reason: 'ALREADY_SIGNED' };
    const at = now();
    a.signatures[userId] = { imagePng: signaturePng, signedAt: at, phoneSnapshot: phone };
    a.otp[userId] = null;
    a.auditTrail.push({ event: 'SIGNED', actorId: userId, at });
    return ok({ ...a });
  });
  if (!recorded.ok) return recorded;
  if (Object.keys(recorded.value.signatures).length === 2) return finalize(agreementId);
  return recorded;
}

/**
 * Render, hash and store the signed PDF, then flip to SIGNED in one write.
 * Safe to call again (e.g. after a storage failure): it only acts on a
 * PENDING agreement holding both signatures.
 */
export async function finalize(agreementId: string): Promise<AgreementResult> {
  const data = await db.read();
  const a = (data.cofounderAgreements ?? []).find((x) => x.id === agreementId);
  if (!a) return { ok: false, reason: 'NOT_FOUND' };
  if (a.status === 'SIGNED') return { ok: true, value: a };
  if (a.status !== 'PENDING_SIGNATURES' || Object.keys(a.signatures).length !== 2 || !a.contentSnapshot) return { ok: false, reason: 'NOT_PENDING' };
  const [p0, p1] = a.parties;
  const signer = (p: string) => ({
    name: a.identities[p]?.legalName ?? '—',
    signatureImagePng: a.signatures[p]!.imagePng,
    signedAt: a.signatures[p]!.signedAt,
    phone: maskPhone(a.signatures[p]!.phoneSnapshot),
  });
  let stored;
  try {
    const pdf = await generateAgreementPdf({ agreementId: a.id, body: a.contentSnapshot, signers: [signer(p0), signer(p1)] });
    stored = await storeSignedContractPdf(pdf, `cofounder-${a.id}`);
  } catch (err) {
    console.error('[cofounder-agreement] finalize failed', err instanceof Error ? err.message : String(err));
    return { ok: false, reason: 'STORAGE_FAILED' };
  }
  return db.update<AgreementResult>((d) => {
    const x = (d.cofounderAgreements ?? []).find((y) => y.id === agreementId);
    if (!x) return { ok: false, reason: 'NOT_FOUND' };
    if (x.status === 'SIGNED') return { ok: true, value: { ...x } };
    if (x.status !== 'PENDING_SIGNATURES') return { ok: false, reason: 'NOT_PENDING' };
    const at = now();
    x.status = 'SIGNED';
    x.finalPdfPublicId = stored.publicId;
    x.finalPdfHash = stored.hash;
    x.signedAt = at;
    x.updatedAt = at;
    x.auditTrail.push({ event: 'COMPLETED', actorId: 'system', at });
    return { ok: true, value: { ...x } };
  });
}

/** The signed PDF bytes, for one of the two founders. */
export async function signedPdf(userId: string, agreementId: string): Promise<Buffer | null> {
  const a = ((await db.read()).cofounderAgreements ?? []).find((x) => x.id === agreementId);
  if (!a || !a.parties.includes(userId) || a.status !== 'SIGNED' || !a.finalPdfPublicId) return null;
  return fetchContractPdfBytes(a.finalPdfPublicId);
}

/** What a founder sees: never the other's signature image or code state. */
export function agreementView(a: CofounderAgreementRecord, viewerId: string) {
  return {
    id: a.id,
    matchId: a.matchId,
    status: a.status,
    me: viewerId,
    parties: a.parties,
    terms: a.terms,
    identities: a.identities,
    version: a.version,
    contentSnapshot: a.contentSnapshot,
    signed: Object.fromEntries(a.parties.map((p) => [p, a.signatures[p]?.signedAt ?? null])),
    finalPdfHash: a.finalPdfHash,
    signedAt: a.signedAt,
  };
}
export type AgreementView = ReturnType<typeof agreementView>;
