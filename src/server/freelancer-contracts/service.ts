/**
 * Freelancer contracts — THE single write path for `d.freelancerContracts`,
 * and the withdrawal eligibility rule that depends on them.
 *
 *   offer      once the profile is 100 % complete, a PENDING_SIGNATURE
 *              contract is created from the template (text frozen, CIN left
 *              as a token) and the freelancer is notified. Idempotent.
 *   sign       drawn signature + CIN + a code sent to the freelancer's own
 *              phone; the CIN is frozen into the text, the PDF is rendered
 *              from it, hashed and stored privately, then the record flips
 *              to SIGNED in one write. Immutable afterwards.
 *   withdraw   refused until the profile is 100 % AND a contract is SIGNED.
 *
 * Same evidence model and building blocks as consultant contracts (OTP
 * throttle, PDF layout, private storage) and the cofounder agreement.
 */
import { randomUUID } from 'node:crypto';
import { db, type FreelancerContractRecord, type UserRecord } from '@/server/db/store';
import { issueOtp, verifyOtp } from '@/server/auth/otp';
import { evaluateSendPolicy, isLockedOut, nextStateAfterLockout, nextStateAfterSend, type OtpSendDecision } from '@/server/consultant-contracts/otp';
import { fetchContractPdfBytes, storeSignedContractPdf } from '@/server/consultant-contracts/storage';
import { generateConsultantContractPdf } from '@/server/consultant-contracts/contract-pdf';
import { findMetworkParty } from '@/server/consultant-contracts/party';
import { createNotification } from '@/server/notifications/create-notification';
import { computeCompletion } from '@/lib/freelancer-completion';
import { entitlementsFor } from '@/lib/entitlements';
import { formatCityLabel } from '@/config/cities';
import { FREELANCER_CONTRACT_DEFAULT, ID_NUMBER_TOKEN, renderFreelancerContract } from '@/lib/freelancer-contract-text';

type Store = Awaited<ReturnType<typeof db.read>>;

const OTP_TTL_MINUTES = 5;
const MIN_SIGNATURE_BYTES = 256;
/** Algerian CIN: 9 to 18 digits (old 9-digit cards, new 18-digit NIN). */
export const CIN_PATTERN = /^\d{9,18}$/;

const otpKey = (contractId: string) => `freelancer-contract:${contractId}`;
const nowIso = () => new Date().toISOString();

export type ContractError =
  | 'NOT_FOUND'
  | 'NOT_PENDING'
  | 'BAD_SIGNATURE'
  | 'BAD_ID_NUMBER'
  | 'LOCKED'
  | 'INVALID'
  | 'EXPIRED'
  | 'TOO_MANY_ATTEMPTS'
  | 'NO_PHONE'
  | 'STORAGE_FAILED';

export type ContractResult<T = FreelancerContractRecord> = { ok: true; value: T } | { ok: false; reason: ContractError };

/* ─────────────────────────── Reads ─────────────────────────── */

function contractsOf(d: Pick<Store, 'freelancerContracts'>, userId: string): FreelancerContractRecord[] {
  return (d.freelancerContracts ?? []).filter((c) => c.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The live contract: the signed one, else the one awaiting signature. */
export function currentContract(d: Pick<Store, 'freelancerContracts'>, userId: string): FreelancerContractRecord | null {
  const mine = contractsOf(d, userId);
  return mine.find((c) => c.status === 'SIGNED') ?? mine.find((c) => c.status === 'PENDING_SIGNATURE') ?? null;
}

export function hasSignedContract(d: Pick<Store, 'freelancerContracts'>, userId: string): boolean {
  return contractsOf(d, userId).some((c) => c.status === 'SIGNED');
}

export function profilePercent(d: Store, user: UserRecord): number {
  const profile = d.freelancerProfiles?.find((p) => p.userId === user.id) ?? null;
  return computeCompletion(user, profile).percent;
}

export type WithdrawBlock = 'PROFILE_INCOMPLETE' | 'CONTRACT_UNSIGNED';

/** Why a freelancer may not withdraw yet, or null when they may. Other roles: never blocked here. */
export function withdrawalBlock(d: Store, user: UserRecord): WithdrawBlock | null {
  if (user.role !== 'FREELANCER') return null;
  if (profilePercent(d, user) < 100) return 'PROFILE_INCOMPLETE';
  if (!hasSignedContract(d, user.id)) return 'CONTRACT_UNSIGNED';
  return null;
}

/* ─────────────────────────── Offer ─────────────────────────── */

const fmtRate = (percent: number) => `${String(percent).replace('.', ',')} %`;

function ratesNow(): FreelancerContractRecord['rates'] {
  const free = entitlementsFor('FREELANCER', false);
  const paid = entitlementsFor('FREELANCER', true);
  return {
    sourcedFree: free.sourcedCommissionPercent,
    sourcedPremium: paid.sourcedCommissionPercent,
    linkFree: free.paymentLinkFeePercent,
    linkPremium: paid.paymentLinkFeePercent,
  };
}

function renderFor(d: Store, user: UserRecord, rates: FreelancerContractRecord['rates']): string {
  const template = d.platformSettings?.freelancerContractTemplate?.trim() || FREELANCER_CONTRACT_DEFAULT;
  const profile = d.freelancerProfiles?.find((p) => p.userId === user.id);
  const city = formatCityLabel(user.city, 'fr');
  const address = [profile?.address?.trim(), city].filter(Boolean).join(', ');
  // The approved document's number, else the one on the invoice settings.
  const aeCard = profile?.legal?.extracted?.documentNumber?.trim()
    || (profile?.invoiceSettings?.invoiceLegalStatus === 'AUTO_ENTREPRENEUR' ? profile.invoiceSettings.invoiceRegNumber?.trim() : '')
    || 'non renseigné';
  return renderFreelancerContract(
    template,
    {
      freelancer_name: user.fullName,
      freelancer_address: address,
      freelancer_city: city,
      freelancer_phone: user.phone ?? '',
      freelancer_email: user.email,
      freelancer_ae_card_number: aeCard,
      mission_rate_free: fmtRate(rates.sourcedFree),
      mission_rate_premium: fmtRate(rates.sourcedPremium),
      link_rate_free: fmtRate(rates.linkFree),
      link_rate_premium: fmtRate(rates.linkPremium),
      today: new Date().toLocaleDateString('fr-DZ', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers' }),
    },
    ['freelancer_id_number'],
  );
}

const OFFER_TITLE = {
  fr: 'Signez votre contrat freelancer Metwork',
  en: 'Sign your Metwork freelancer contract',
  ar: 'وقّع عقد المستقل مع Metwork',
} as const;
const OFFER_BODY = {
  fr: 'Votre profil est complet. Signez le contrat pour pouvoir retirer votre argent.',
  en: 'Your profile is complete. Sign the contract to be able to withdraw your money.',
  ar: 'ملفك مكتمل. وقّع العقد لتتمكن من سحب أموالك.',
} as const;

/**
 * Offer the contract if the freelancer is eligible and has none: profile at
 * 100 %, no signed or pending contract. Returns whether one was created.
 * Safe to call from any profile-changing path and on page loads.
 */
export async function offerContractIfEligible(userId: string): Promise<boolean> {
  // Cheap read first: this runs on every freelancer page load, and the write
  // lock (plus a full-document save) is only worth taking when it will create.
  const pre = await db.read();
  const preUser = pre.users.find((u) => u.id === userId);
  if (!preUser || preUser.role !== 'FREELANCER' || currentContract(pre, userId) || profilePercent(pre, preUser) < 100) return false;
  const created = await db.update<{ locale: string | null } | null>((d) => {
    const user = d.users.find((u) => u.id === userId);
    if (!user || user.role !== 'FREELANCER') return null;
    if (currentContract(d, userId)) return null;
    if (profilePercent(d, user) < 100) return null;
    const rates = ratesNow();
    const at = nowIso();
    if (!d.freelancerContracts) d.freelancerContracts = [];
    d.freelancerContracts.push({
      id: randomUUID(),
      userId,
      status: 'PENDING_SIGNATURE',
      contentSnapshot: renderFor(d, user, rates),
      rates,
      idNumber: null,
      signature: null,
      otp: null,
      finalPdfPublicId: null,
      finalPdfHash: null,
      signedAt: null,
      voidedAt: null,
      auditTrail: [{ event: 'CREATED', actorId: 'system', at }],
      createdAt: at,
    });
    return { locale: user.locale ?? null };
  });
  if (!created) return false;
  const l = created.locale === 'en' || created.locale === 'ar' ? created.locale : 'fr';
  await createNotification({ userId, type: 'GENERAL', title: OFFER_TITLE[l], body: OFFER_BODY[l], href: '/dashboard/freelancer/contract' });
  return true;
}

/* ─────────────────────────── Sign ─────────────────────────── */

/** Mutate the caller's PENDING contract. Signed/voided records are never handed to `fn`. */
async function mutatePending<T>(userId: string, contractId: string, fn: (c: FreelancerContractRecord) => ContractResult<T>): Promise<ContractResult<T>> {
  return db.update<ContractResult<T>>((d) => {
    const c = (d.freelancerContracts ?? []).find((x) => x.id === contractId && x.userId === userId);
    if (!c) return { ok: false, reason: 'NOT_FOUND' };
    if (c.status !== 'PENDING_SIGNATURE') return { ok: false, reason: 'NOT_PENDING' };
    return fn(c);
  });
}

export type SendCodeResult =
  | { ok: true; code: string; phone: string; expiresAt: string }
  | { ok: false; reason: ContractError }
  | { ok: false; reason: 'THROTTLED'; detail: Extract<OtpSendDecision, { allowed: false }> };

/** Issue a signing code to the freelancer's own phone. Delivery is the route's job. */
export async function sendSigningCode(userId: string, contractId: string): Promise<SendCodeResult> {
  const phone = (await db.read()).users.find((u) => u.id === userId)?.phone?.trim();
  if (!phone) return { ok: false, reason: 'NO_PHONE' };
  const t = Date.now();
  const gate = await mutatePending<Extract<OtpSendDecision, { allowed: false }> | null>(userId, contractId, (c) => {
    const decision = evaluateSendPolicy(c.otp, t);
    if (!decision.allowed) return { ok: true, value: decision };
    c.auditTrail.push({ event: c.otp?.lastSentAt ? 'RESEND_OTP' : 'OTP_SENT', actorId: userId, at: new Date(t).toISOString() });
    c.otp = nextStateAfterSend(c.otp, t);
    return { ok: true, value: null };
  });
  if (!gate.ok) return gate;
  if (gate.value) return { ok: false, reason: 'THROTTLED', detail: gate.value };
  const { code, expiresAt } = await issueOtp(otpKey(contractId), { ttlMinutes: OTP_TTL_MINUTES });
  return { ok: true, code, phone, expiresAt };
}

function signatureBytes(dataUri: string): number {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUri ?? '');
  return m?.[1] ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').length : 0;
}

/**
 * Sign: check the drawing and the CIN before spending the code, verify the
 * code, freeze the CIN into the text, render + store the PDF, then flip to
 * SIGNED in one write (never observable as signed-but-unstored).
 */
export async function signContract(
  userId: string,
  contractId: string,
  input: { signaturePng: string; code: string; idNumber: string },
): Promise<ContractResult> {
  if (signatureBytes(input.signaturePng) < MIN_SIGNATURE_BYTES) return { ok: false, reason: 'BAD_SIGNATURE' };
  const idNumber = input.idNumber.replace(/\s+/g, '');
  if (!CIN_PATTERN.test(idNumber)) return { ok: false, reason: 'BAD_ID_NUMBER' };

  const data = await db.read();
  const c0 = (data.freelancerContracts ?? []).find((x) => x.id === contractId && x.userId === userId);
  if (!c0) return { ok: false, reason: 'NOT_FOUND' };
  if (c0.status !== 'PENDING_SIGNATURE') return { ok: false, reason: 'NOT_PENDING' };
  if (isLockedOut(c0.otp, Date.now())) return { ok: false, reason: 'LOCKED' };

  const verified = await verifyOtp(otpKey(contractId), input.code);
  if (!verified.ok) {
    const t = Date.now();
    await mutatePending(userId, contractId, (c) => {
      c.auditTrail.push({ event: 'OTP_FAILED', actorId: userId, at: new Date(t).toISOString() });
      if (verified.reason === 'TOO_MANY_ATTEMPTS') c.otp = nextStateAfterLockout(c.otp, t);
      return { ok: true, value: null };
    });
    if (verified.reason === 'TOO_MANY_ATTEMPTS') return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };
    return { ok: false, reason: verified.reason === 'EXPIRED' ? 'EXPIRED' : 'INVALID' };
  }

  const user = data.users.find((u) => u.id === userId);
  const phone = user?.phone ?? '';
  const body = c0.contentSnapshot.split(ID_NUMBER_TOKEN).join(idNumber);
  const signedAt = nowIso();
  let stored: { publicId: string; hash: string };
  try {
    const pdf = await generateConsultantContractPdf({
      contractId: c0.id,
      consultantName: user?.fullName ?? 'Freelancer',
      signerLabel: 'Freelancer',
      titleSubtitle: 'ENTRE METWORK ET LE FREELANCER',
      body,
      signerPhoneSnapshot: phone,
      signatureImagePng: input.signaturePng,
      signedAt,
      adminStampUrl: data.platformSettings?.adminStampImageUrl ?? null,
      metworkName: findMetworkParty(data)?.name,
      metworkManager: data.platformSettings?.metworkManagerName ?? null,
    });
    stored = await storeSignedContractPdf(pdf, `freelancer-${c0.id}`);
  } catch (err) {
    console.error('[freelancer-contract] sign failed', err instanceof Error ? err.message : String(err));
    await mutatePending(userId, contractId, (c) => {
      c.auditTrail.push({ event: 'STORAGE_FAILED', actorId: 'system', at: nowIso() });
      return { ok: true, value: null };
    });
    return { ok: false, reason: 'STORAGE_FAILED' };
  }

  return mutatePending(userId, contractId, (c) => {
    c.status = 'SIGNED';
    c.contentSnapshot = body;
    c.idNumber = idNumber;
    c.signature = { imagePng: input.signaturePng, signedAt, phoneSnapshot: phone };
    c.finalPdfPublicId = stored.publicId;
    c.finalPdfHash = stored.hash;
    c.signedAt = signedAt;
    c.otp = null;
    c.auditTrail.push({ event: 'SIGNED', actorId: userId, at: signedAt });
    return { ok: true, value: { ...c } };
  });
}

/** Signed PDF bytes, for its own freelancer only. */
export async function signedContractPdf(userId: string, contractId: string): Promise<Buffer | null> {
  const c = ((await db.read()).freelancerContracts ?? []).find((x) => x.id === contractId && x.userId === userId);
  if (!c || c.status !== 'SIGNED' || !c.finalPdfPublicId) return null;
  return fetchContractPdfBytes(c.finalPdfPublicId);
}

/** What the freelancer sees: never the code state or the signature image. */
export function contractView(c: FreelancerContractRecord) {
  return {
    id: c.id,
    status: c.status,
    contentSnapshot: c.contentSnapshot,
    rates: c.rates,
    idNumber: c.idNumber,
    signedAt: c.signedAt,
    finalPdfHash: c.finalPdfHash,
    createdAt: c.createdAt,
  };
}
export type FreelancerContractView = ReturnType<typeof contractView>;
