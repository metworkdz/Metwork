/**
 * Consultant contract service — THE single write path for
 * `d.consultantContracts`.
 *
 * These records are evidence. They exist so that, if the tax authority asks
 * why consultation money passed through Metwork's accounts, there is a signed
 * mandate showing Metwork collected it on the consultant's behalf and paid it
 * out minus commission. A record that can be quietly edited after signature
 * proves nothing, so the two rules below are enforced HERE rather than in the
 * route handlers or the UI:
 *
 *  1. FROZEN SNAPSHOTS. `contentSnapshot`, `commissionRate`, `payoutMethod`,
 *     `payoutDetails` and `signerPhoneSnapshot` are captured in `sendContract`
 *     and never re-read from the live consultant profile afterwards. If the
 *     consultant later changes their phone or bank account, the contract still
 *     says what they agreed to.
 *
 *  2. IMMUTABILITY. Once a contract is SIGNED (or VOIDED) the only legal write
 *     is an append to `auditTrail`. Every mutation in this file goes through
 *     `updateContract()`, which runs the caller's mutator against a clone,
 *     diffs the result, and refuses to persist a violating change. No route
 *     may call `db.update` on this collection directly — see
 *     `src/__tests__/consultant-contracts/no-direct-db-writes.test.ts`.
 *
 * OTP handling defers entirely to `@/server/auth/otp` (via `./otp`); the send
 * throttle and lockout policy are the pure functions in `./otp`, applied here
 * because this is where the record can be written.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  type ConsultantContractAuditEvent,
  type ConsultantContractOtpState,
  type ConsultantContractPayoutMethod,
  type ConsultantContractRecord,
  type MentorRecord,
} from '@/server/db/store';
import { resolveMentorCommissionRates } from '@/server/payments/mentor-commission';
import { generateConsultantContractPdf } from './contract-pdf';
import { findMetworkParty, missingLegalFields, type MetworkLegalField } from './party';
import { mintContractPdfUrl, storeSignedContractPdf } from './storage';
import {
  evaluateSendPolicy,
  isLockedOut,
  issueContractOtp,
  nextStateAfterLockout,
  nextStateAfterSend,
  verifyContractOtp,
  type OtpSendDecision,
} from './otp';

/* ─────────────────── Reads ─────────────────── */

function allContracts(d: { consultantContracts?: ConsultantContractRecord[] }): ConsultantContractRecord[] {
  // Legacy blobs predate the collection; the empty-merge normally supplies [],
  // but a mutator may run against a document that never went through it.
  if (!Array.isArray(d.consultantContracts)) d.consultantContracts = [];
  return d.consultantContracts;
}

/** Every contract, newest first. */
export async function listContracts(): Promise<ConsultantContractRecord[]> {
  const data = await db.read();
  return [...(data.consultantContracts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findContractById(id: string): Promise<ConsultantContractRecord | null> {
  const data = await db.read();
  return (data.consultantContracts ?? []).find((c) => c.id === id) ?? null;
}

/** One consultant's contracts, newest first. */
export async function findContractsByConsultant(
  consultantId: string,
): Promise<ConsultantContractRecord[]> {
  const data = await db.read();
  return (data.consultantContracts ?? [])
    .filter((c) => c.consultantId === consultantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The contract a consultant is currently being asked to sign, if any. Drives
 * the portal's notification banner. Newest wins when several are outstanding.
 */
export async function findPendingContractForConsultant(
  consultantId: string,
): Promise<ConsultantContractRecord | null> {
  const list = await findContractsByConsultant(consultantId);
  return list.find((c) => c.status === 'PENDING_SIGNATURE') ?? null;
}

/* ─────────────────── Immutability gateway ─────────────────── */

/**
 * Fields a SIGNED contract may still legally change.
 *
 * `auditTrail` is append-only but always writable — a signed contract must
 * keep recording who viewed or downloaded it.
 *
 * `finalPdfUrl` is here as a deliberate, narrow exception: it caches a Cloudinary
 * SIGNED url that EXPIRES, so it has to be re-mintable. It is not evidence —
 * `finalPdfPublicId` (which asset) and `finalPdfHash` (which exact bytes) are,
 * and both are frozen. Re-minting a link cannot change what was signed.
 */
const SIGNED_MUTABLE_FIELDS = new Set<keyof ConsultantContractRecord>(['auditTrail', 'finalPdfUrl']);

/** A VOIDED contract is fully terminal — nothing but the trail may move. */
const VOIDED_MUTABLE_FIELDS = new Set<keyof ConsultantContractRecord>(['auditTrail']);

/**
 * Name the first field a mutation touched that it was not allowed to, or null
 * when the change is legal.
 *
 * Compared by serialised value rather than reference so a mutator that
 * reassigns a field to an equal object is not flagged — we care about what the
 * record SAYS, not how it was written.
 */
function findImmutabilityViolation(
  before: ConsultantContractRecord,
  after: ConsultantContractRecord,
): string | null {
  // Append-only trail, in EVERY status: existing entries may never be
  // rewritten, reordered or dropped, only extended.
  if (after.auditTrail.length < before.auditTrail.length) return 'auditTrail (truncated)';
  for (let i = 0; i < before.auditTrail.length; i++) {
    if (JSON.stringify(after.auditTrail[i]) !== JSON.stringify(before.auditTrail[i])) {
      return `auditTrail[${i}] (rewritten)`;
    }
  }

  const frozen =
    before.status === 'SIGNED'
      ? SIGNED_MUTABLE_FIELDS
      : before.status === 'VOIDED'
        ? VOIDED_MUTABLE_FIELDS
        : null;
  if (!frozen) return null;

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof ConsultantContractRecord>;
  for (const key of keys) {
    if (frozen.has(key)) continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) return String(key);
  }
  return null;
}

export type UpdateContractResult<T> =
  | { ok: true; value: T; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'IMMUTABLE'; field: string };

/**
 * Apply `mutator` to one contract inside the store's serialized critical
 * section, then persist ONLY if the result respects the immutability rules.
 *
 * The mutator runs against a clone, so a rejected mutation leaves the stored
 * record byte-identical — a caller cannot half-apply a forbidden change.
 */
export async function updateContract<T>(
  contractId: string,
  mutator: (contract: ConsultantContractRecord) => T,
): Promise<UpdateContractResult<T>> {
  return db.update<UpdateContractResult<T>>((d) => {
    const list = allContracts(d);
    const index = list.findIndex((c) => c.id === contractId);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const before = list[index]!;
    const draft = structuredClone(before);
    const value = mutator(draft);

    const violation = findImmutabilityViolation(before, draft);
    if (violation) return { ok: false, reason: 'IMMUTABLE', field: violation };

    list[index] = draft;
    return { ok: true, value, contract: draft };
  });
}

/** Append one audit entry. Legal in every status, including SIGNED and VOIDED. */
export async function appendContractAudit(
  contractId: string,
  event: ConsultantContractAuditEvent,
  actorId: string,
): Promise<ConsultantContractRecord | null> {
  const result = await updateContract(contractId, (c) => {
    c.auditTrail.push({ event, actorId, timestamp: new Date().toISOString() });
  });
  return result.ok ? result.contract : null;
}

/* ─────────────────── Create / edit while DRAFT ─────────────────── */

export interface CreateDraftContractInput {
  consultantId: string;
  /** French contract body, `{{variables}}` already substituted. */
  contentSnapshot: string;
  payoutMethod: ConsultantContractPayoutMethod;
  payoutDetails?: string | null;
  /** UserRecord.id of the creating admin. */
  actorId: string;
}

/**
 * Create a DRAFT. Nothing is frozen yet — every field here stays editable
 * until `sendContract` captures the snapshot.
 */
export async function createDraftContract(
  input: CreateDraftContractInput,
): Promise<ConsultantContractRecord> {
  const now = new Date().toISOString();
  const record: ConsultantContractRecord = {
    id: randomUUID(),
    consultantId: input.consultantId,
    status: 'DRAFT',
    templateVersion: 1,
    contentSnapshot: input.contentSnapshot,
    // Placeholder only. The binding rate is resolved and frozen at send-time;
    // a draft that sits for a week must not carry a stale number into the PDF.
    commissionRate: 0,
    payoutMethod: input.payoutMethod,
    payoutDetails: input.payoutDetails ?? null,
    signerPhoneSnapshot: '',
    signature: null,
    adminStamp: null,
    finalPdfPublicId: null,
    finalPdfUrl: null,
    finalPdfHash: null,
    otp: null,
    auditTrail: [{ event: 'CREATED', actorId: input.actorId, timestamp: now }],
    createdAt: now,
    sentAt: null,
    signedAt: null,
    voidedAt: null,
  };

  await db.update((d) => {
    allContracts(d).push(record);
  });
  return record;
}

export type EditDraftResult =
  | { ok: true; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_DRAFT' };

/**
 * Revise a contract's terms. Legal ONLY while DRAFT — once sent, the path
 * forward for changed terms is void + create a new contract, so that what the
 * consultant was asked to sign is never rewritten underneath them.
 */
export async function editDraftContract(
  contractId: string,
  patch: {
    contentSnapshot?: string;
    payoutMethod?: ConsultantContractPayoutMethod;
    payoutDetails?: string | null;
  },
): Promise<EditDraftResult> {
  const result = await updateContract(contractId, (c) => {
    if (c.status !== 'DRAFT') return 'NOT_DRAFT' as const;
    if (patch.contentSnapshot !== undefined) c.contentSnapshot = patch.contentSnapshot;
    if (patch.payoutMethod !== undefined) c.payoutMethod = patch.payoutMethod;
    if (patch.payoutDetails !== undefined) c.payoutDetails = patch.payoutDetails;
    c.templateVersion += 1;
    return 'OK' as const;
  });

  if (!result.ok) return { ok: false, reason: 'NOT_FOUND' };
  if (result.value === 'NOT_DRAFT') return { ok: false, reason: 'NOT_DRAFT' };
  return { ok: true, contract: result.contract };
}

/* ─────────────────── Send (DRAFT → PENDING_SIGNATURE) ─────────────────── */

/**
 * Render a payout account into the one-line description printed on the
 * contract. The account number is masked to its last 4 digits: the contract
 * must identify the account unambiguously to its holder without turning every
 * copy of the PDF into a full set of bank details.
 */
export function describePayoutAccount(mentor: MentorRecord): string | null {
  const account = mentor.payoutAccount;
  if (!account?.accountNumber) return null;
  const digits = account.accountNumber.replace(/\s+/g, '');
  const masked = digits.length > 4 ? `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : digits;
  const label = account.accountType === 'ccp' ? 'CCP' : 'RIB';
  return `${label} ${masked} — ${account.holderName}`;
}

export type SendContractResult =
  | { ok: true; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_DRAFT' | 'CONSULTANT_NOT_FOUND' | 'NO_VERIFIED_PHONE' | 'EMPTY_CONTENT' }
  | { ok: false; reason: 'METWORK_LEGAL_INCOMPLETE'; missing: MetworkLegalField[] };

/**
 * Freeze the terms and put the contract in front of the consultant.
 *
 * This is the moment every snapshot is taken. The commission rate comes from
 * `resolveMentorCommissionRates` — the same resolver settlement uses — read
 * inside the write lock so the contract and the ledger can never disagree about
 * what the rate was at this instant. It is never hardcoded, and never re-read
 * afterwards.
 *
 * A verified phone is required: the signing OTP is the identity proof behind
 * the signature, so sending one to an unverified number would make the
 * signature unattributable.
 */
export async function sendContract(
  contractId: string,
  actorId: string,
): Promise<SendContractResult> {
  const now = new Date().toISOString();

  const outcome = await db.update<SendContractResult | { ok: 'DEFER' }>((d) => {
    const list = allContracts(d);
    const index = list.findIndex((c) => c.id === contractId);
    if (index === -1) return { ok: false, reason: 'NOT_FOUND' };

    const before = list[index]!;
    if (before.status !== 'DRAFT') return { ok: false, reason: 'NOT_DRAFT' };
    if (!before.contentSnapshot.trim()) return { ok: false, reason: 'EMPTY_CONTENT' };

    const mentor = (d.mentors ?? []).find((m) => m.id === before.consultantId);
    if (!mentor) return { ok: false, reason: 'CONSULTANT_NOT_FOUND' };

    const phone = mentor.phone?.trim();
    if (!phone || !mentor.phoneVerified) return { ok: false, reason: 'NO_VERIFIED_PHONE' };

    // A contract that cannot name Metwork's commercial register number and tax
    // identifier proves nothing to a tax authority. Blocked here rather than
    // rendered with blank lines — see `party.ts`.
    const missing = missingLegalFields(findMetworkParty(d));
    if (missing.length) return { ok: false, reason: 'METWORK_LEGAL_INCOMPLETE', missing };

    const { platformRate } = resolveMentorCommissionRates(d.commissionRules, { kind: 'CONSULTATION' });

    const draft = structuredClone(before);
    draft.status = 'PENDING_SIGNATURE';
    draft.commissionRate = platformRate;
    draft.signerPhoneSnapshot = phone;
    // Cheque needs no account; for the other two the frozen description is
    // what the consultant sees and signs, not the live profile field.
    draft.payoutDetails =
      draft.payoutMethod === 'CHEQUE' ? null : (describePayoutAccount(mentor) ?? draft.payoutDetails);
    draft.sentAt = now;
    draft.auditTrail.push({ event: 'SENT', actorId, timestamp: now });

    const violation = findImmutabilityViolation(before, draft);
    if (violation) return { ok: false, reason: 'NOT_DRAFT' };

    list[index] = draft;
    return { ok: true, contract: draft };
  });

  return outcome as SendContractResult;
}

/* ─────────────────── Void ─────────────────── */

export type VoidContractResult =
  | { ok: true; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'NOT_CONFIRMED' };

/**
 * Void a contract awaiting signature.
 *
 * Irreversible, so the caller must pass `confirm: true` explicitly — a UI click
 * alone is not the gate; a direct API call missing the flag is refused here, in
 * the service. A SIGNED contract can never be voided: it is evidence of an
 * agreement that genuinely happened.
 */
export async function voidContract(
  contractId: string,
  actorId: string,
  options: { confirm: boolean },
): Promise<VoidContractResult> {
  if (!options.confirm) return { ok: false, reason: 'NOT_CONFIRMED' };

  const now = new Date().toISOString();
  const result = await updateContract(contractId, (c) => {
    if (c.status !== 'PENDING_SIGNATURE') return 'NOT_PENDING' as const;
    c.status = 'VOIDED';
    c.voidedAt = now;
    // A voided contract must never accept a signature; drop the live OTP state
    // so an in-flight code cannot be redeemed against it.
    c.otp = null;
    c.auditTrail.push({ event: 'VOIDED', actorId, timestamp: now });
    return 'OK' as const;
  });

  if (!result.ok) return { ok: false, reason: 'NOT_FOUND' };
  if (result.value === 'NOT_PENDING') return { ok: false, reason: 'NOT_PENDING' };
  return { ok: true, contract: result.contract };
}

/* ─────────────────── Signing OTP ─────────────────── */

export type SendSigningOtpResult =
  | { ok: true; code: string; expiresAt: string; phone: string; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' }
  | { ok: false; reason: 'THROTTLED'; detail: Extract<OtpSendDecision, { allowed: false }> };

/**
 * Issue a signing code for a contract awaiting signature.
 *
 * The throttle decision is made against the CURRENT stored state inside the
 * write lock, and the counters advance in the same critical section, so two
 * concurrent resend clicks cannot both pass the cap.
 *
 * The plaintext code is returned for the caller to deliver. Delivery is the
 * caller's job and is deliberately non-blocking: a failed WhatsApp/SMS send
 * must never roll back an issued code, or the consultant would be throttled for
 * a message they never received.
 */
export async function sendSigningOtp(
  contractId: string,
  actorId: string,
): Promise<SendSigningOtpResult> {
  const now = Date.now();

  // Gate first, against the stored state, inside the lock.
  const gate = await updateContract(contractId, (c) => {
    if (c.status !== 'PENDING_SIGNATURE') return { kind: 'NOT_PENDING' } as const;
    const decision = evaluateSendPolicy(c.otp, now);
    if (!decision.allowed) return { kind: 'THROTTLED', decision } as const;
    // Distinguish the first code this contract ever sent from every later one,
    // rather than keying off the per-window counter — an audit reading the
    // trail should see a resend as a resend even when it follows a lapsed
    // window that reset the count.
    const isResend = c.otp?.lastSentAt != null;
    c.otp = nextStateAfterSend(c.otp, now);
    c.auditTrail.push({
      event: isResend ? 'RESEND_OTP' : 'OTP_SENT',
      actorId,
      timestamp: new Date(now).toISOString(),
    });
    return { kind: 'OK', phone: c.signerPhoneSnapshot } as const;
  });

  if (!gate.ok) return { ok: false, reason: 'NOT_FOUND' };
  if (gate.value.kind === 'NOT_PENDING') return { ok: false, reason: 'NOT_PENDING' };
  if (gate.value.kind === 'THROTTLED') return { ok: false, reason: 'THROTTLED', detail: gate.value.decision };

  const { code, expiresAt } = await issueContractOtp(contractId);
  return { ok: true, code, expiresAt, phone: gate.value.phone, contract: gate.contract };
}

export type VerifySigningOtpResult =
  | { ok: true; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'LOCKED' | 'INVALID' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' };

/**
 * Check a signing code.
 *
 * Success here proves the signer controls the phone frozen onto the contract —
 * it does NOT flip the status to SIGNED. That transition also needs the
 * rendered PDF, its hash and its stored location, and all four have to land
 * together; Phase 2 adds that step. Verification's only durable effect is the
 * audit entry and, on exhaustion, the lockout.
 */
export async function verifySigningOtp(
  contractId: string,
  code: string,
  actorId: string,
): Promise<VerifySigningOtpResult> {
  const now = Date.now();

  const contract = await findContractById(contractId);
  if (!contract) return { ok: false, reason: 'NOT_FOUND' };
  if (contract.status !== 'PENDING_SIGNATURE') return { ok: false, reason: 'NOT_PENDING' };
  if (isLockedOut(contract.otp, now)) return { ok: false, reason: 'LOCKED' };

  const result = await verifyContractOtp(contractId, code);

  if (result.ok) {
    await appendContractAudit(contractId, 'OTP_VERIFIED', actorId);
    const fresh = await findContractById(contractId);
    return fresh ? { ok: true, contract: fresh } : { ok: false, reason: 'NOT_FOUND' };
  }

  // Every failure is recorded — a burst of OTP_FAILED entries on a contract is
  // exactly the signal an audit of a disputed signature would look for.
  await updateContract(contractId, (c) => {
    c.auditTrail.push({ event: 'OTP_FAILED', actorId, timestamp: new Date(now).toISOString() });
    if (result.reason === 'TOO_MANY_ATTEMPTS') {
      c.otp = nextStateAfterLockout(c.otp, now);
    }
  });

  if (result.reason === 'TOO_MANY_ATTEMPTS') return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
  if (result.reason === 'EXPIRED') return { ok: false, reason: 'EXPIRED' };
  return { ok: false, reason: 'INVALID' };
}

/* ─────────────────── Signing (PENDING_SIGNATURE → SIGNED) ─────────────────── */

export type SignContractResult =
  | { ok: true; contract: ConsultantContractRecord }
  | { ok: false; reason: 'NOT_FOUND' | 'NOT_PENDING' | 'LOCKED' | 'INVALID' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' }
  | { ok: false; reason: 'BAD_SIGNATURE' }
  | { ok: false; reason: 'METWORK_LEGAL_INCOMPLETE'; missing: MetworkLegalField[] }
  | { ok: false; reason: 'STORAGE_FAILED'; message: string };

export interface SignContractInput {
  /** `data:image/png;base64,…` from the signature canvas. */
  signatureImagePng: string;
  /** The one-time code sent to `signerPhoneSnapshot`. */
  otpCode: string;
  /** MentorRecord.id of the signing consultant. */
  actorId: string;
}

/** Smallest plausible drawn signature. Below this the canvas was effectively blank. */
const MIN_SIGNATURE_BYTES = 256;

/**
 * Complete a signature: verify the code, render the PDF, hash it, store it, and
 * flip the contract to SIGNED.
 *
 * MUTUAL EXCLUSION comes from the OTP itself. `verifySigningOtp` consumes the
 * code inside the store's critical section, so of two concurrent sign requests
 * exactly one gets past it — there is no second lock to take, and no window in
 * which two PDFs could be produced for one contract.
 *
 * ORDERING is deliberate. The PDF is rendered and uploaded BEFORE the status
 * flips, and the flip writes the pdf id, the hash, the signature and the
 * timestamp together in a single `db.update`. A contract is therefore never
 * observable as SIGNED-but-unstored. The cost of that ordering is that a
 * failure after upload leaves an orphaned Cloudinary asset; that is the
 * harmless direction to fail, and far better than a signed record pointing at
 * nothing.
 *
 * The render is NOT held inside the write lock: it fetches remote images and
 * uploads over the network, and the store's write queue is process-wide, so
 * holding it would stall every unrelated write for the duration.
 */
export async function signContract(
  contractId: string,
  input: SignContractInput,
): Promise<SignContractResult> {
  const contract = await findContractById(contractId);
  if (!contract) return { ok: false, reason: 'NOT_FOUND' };
  if (contract.status !== 'PENDING_SIGNATURE') return { ok: false, reason: 'NOT_PENDING' };

  // Reject a blank or malformed canvas BEFORE spending the one-time code — a
  // consultant who submits an empty signature should be able to retry without
  // waiting out the resend throttle.
  const signatureBytes = decodeSignatureBytes(input.signatureImagePng);
  if (!signatureBytes || signatureBytes < MIN_SIGNATURE_BYTES) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  const verified = await verifySigningOtp(contractId, input.otpCode, input.actorId);
  if (!verified.ok) return { ok: false, reason: verified.reason };

  // Re-read the parties inside a single snapshot so the PDF is built from one
  // consistent view of the document.
  const data = await db.read();
  const metwork = findMetworkParty(data);
  const missing = missingLegalFields(metwork);
  if (missing.length) return { ok: false, reason: 'METWORK_LEGAL_INCOMPLETE', missing };

  const mentor = (data.mentors ?? []).find((m) => m.id === contract.consultantId);
  const adminStampUrl = data.platformSettings?.adminStampImageUrl ?? null;
  const signedAt = new Date().toISOString();

  let stored;
  try {
    const pdf = await generateConsultantContractPdf({
      metwork: metwork!,
      contractId: contract.id,
      consultantName: mentor?.fullName ?? 'Consultant',
      // Every printed term comes from the frozen record, never the live
      // profile — re-rendering this contract in five years must produce the
      // same document.
      body: contract.contentSnapshot,
      commissionRate: contract.commissionRate,
      payoutMethod: contract.payoutMethod,
      payoutDetails: contract.payoutDetails,
      signerPhoneSnapshot: contract.signerPhoneSnapshot,
      signatureImagePng: input.signatureImagePng,
      signedAt,
      adminStampUrl,
    });
    stored = await storeSignedContractPdf(pdf, contract.id);
  } catch (err) {
    // The code is already spent at this point. Recorded so the audit trail
    // explains the gap between OTP_VERIFIED and a missing SIGNED.
    const message = err instanceof Error ? err.message : 'Contract storage failed';
    console.error('[consultant-contracts] sign failed:', err);
    return { ok: false, reason: 'STORAGE_FAILED', message };
  }

  // One atomic write: status, signature, stamp, pdf location, hash, timestamp
  // and the audit entry all land together or not at all.
  const result = await updateContract(contractId, (c) => {
    if (c.status !== 'PENDING_SIGNATURE') return 'RACED' as const;
    c.status = 'SIGNED';
    c.signature = { imagePng: input.signatureImagePng, signedAt };
    c.adminStamp = adminStampUrl ? { imageUrl: adminStampUrl, appliedAt: signedAt } : null;
    c.finalPdfPublicId = stored.publicId;
    c.finalPdfUrl = stored.url;
    c.finalPdfHash = stored.hash;
    c.signedAt = signedAt;
    // The signing code is spent and the contract is closed to further codes.
    c.otp = null;
    c.auditTrail.push({ event: 'SIGNED', actorId: input.actorId, timestamp: signedAt });
    return 'OK' as const;
  });

  if (!result.ok) return { ok: false, reason: 'NOT_FOUND' };
  if (result.value === 'RACED') return { ok: false, reason: 'NOT_PENDING' };
  return { ok: true, contract: result.contract };
}

/** Byte length of a data-URI PNG payload, or null when it is not one. */
function decodeSignatureBytes(dataUri: string): number | null {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri ?? '');
  if (!match?.[1]) return null;
  try {
    return Buffer.from(match[1].replace(/\s+/g, ''), 'base64').length;
  } catch {
    return null;
  }
}

/* ─────────────────── Signed PDF access ─────────────────── */

/**
 * A fresh link to a signed contract's PDF.
 *
 * Minted on every request rather than served from `finalPdfUrl`, because the
 * stored one expires within minutes of being created. The refreshed link is
 * written back as a cache — one of only two fields a SIGNED contract may still
 * change (see `SIGNED_MUTABLE_FIELDS`).
 */
export async function getContractPdfUrl(contractId: string): Promise<string | null> {
  const contract = await findContractById(contractId);
  if (!contract?.finalPdfPublicId) return null;

  const url = mintContractPdfUrl(contract.finalPdfPublicId);
  await updateContract(contractId, (c) => { c.finalPdfUrl = url; });
  return url;
}

/** Record that the consultant opened the contract. Best-effort, never throws. */
export async function markContractViewed(contractId: string, actorId: string): Promise<void> {
  await appendContractAudit(contractId, 'VIEWED', actorId);
}

/** Re-exported so callers need only one import for the OTP state type. */
export type { ConsultantContractOtpState };
