/**
 * Freelancer profiles — THE service for profile edits, the business document
 * and the Premium trial. Routes stay thin: they authenticate and validate,
 * this module decides and writes.
 *
 * Every write validates before it mutates (db.update has no rollback), and
 * re-stamps the trial unlock from the stored records, so the 100 % that
 * unlocks the trial is always the server's own computation.
 */
import { randomUUID } from 'node:crypto';
import { db, type FreelancerProfileRecord, type FreelancerPortfolioItem } from '@/server/db/store';
import { computeCompletion } from '@/lib/freelancer-completion';
import { computePeriodEnd } from '@/lib/billing-cycles';
import { isFreelancerPremiumOnSale } from '@/config/feature-flags';
import { acceptedDocumentsFor, type LegalDocumentKind, type LegalStatus } from '@/types/legal-status';
import {
  destroyAuthenticatedRaw,
  uploadAuthenticatedRaw,
  isConfigured as isCloudinaryConfigured,
} from '@/lib/cloudinary';
import { planConfigsFrom } from '@/server/memberships/plan-config';
import { getEffectiveMembershipCode } from '@/server/memberships/service';
import { normalizePlanCode } from '@/lib/membership-benefits';
import {
  decideLegalReview,
  extractLegalDocument,
  type ReviewDecision,
} from '@/server/freelancers/legal-review';
import { offerContractIfEligible } from '@/server/freelancer-contracts/service';

type Draft = Parameters<Parameters<typeof db.update>[0]>[0];

export const LEGAL_DOCUMENT_FOLDER = 'metwork/legal-documents';

export function emptyProfile(userId: string, now: string): FreelancerProfileRecord {
  return {
    userId,
    headline: null,
    bio: null,
    skills: [],
    languages: [],
    remote: true,
    dayRate: null,
    address: null,
    portfolio: [],
    legal: null,
    createdAt: now,
    updatedAt: now,
  };
}

function profileIn(d: Draft, userId: string, now: string): FreelancerProfileRecord {
  if (!Array.isArray(d.freelancerProfiles)) d.freelancerProfiles = [];
  let p = d.freelancerProfiles.find((x) => x.userId === userId);
  if (!p) {
    p = emptyProfile(userId, now);
    d.freelancerProfiles.push(p);
  }
  return p;
}

/** Stamp the trial unlock the first time the stored records reach 100 %. */
function stampTrialUnlock(d: Draft, userId: string, now: string): void {
  const user = d.users.find((u) => u.id === userId);
  const p = d.freelancerProfiles?.find((x) => x.userId === userId);
  if (!user || !p || p.trial?.unlockedAt) return;
  if (computeCompletion(user, p).percent === 100) p.trial = { unlockedAt: now };
}

// ── Profile ────────────────────────────────────────────────────────────────

export interface ProfileInput {
  headline: string | null;
  bio: string | null;
  skills: string[];
  languages: string[];
  remote: boolean;
  dayRate: number | null;
  address: string | null;
  portfolio: Array<Omit<FreelancerPortfolioItem, 'id'> & { id?: string }>;
}

export async function updateFreelancerProfile(userId: string, input: ProfileInput): Promise<FreelancerProfileRecord> {
  const now = new Date().toISOString();
  return db.update((d) => {
    const p = profileIn(d, userId, now);
    p.headline = input.headline?.trim() || null;
    p.bio = input.bio?.trim() || null;
    // De-duplicated, order kept, blanks dropped.
    p.skills = [...new Set(input.skills.map((s) => s.trim()).filter(Boolean))];
    p.languages = [...new Set(input.languages)];
    p.remote = input.remote;
    p.dayRate = input.dayRate;
    p.address = input.address?.trim() || null;
    p.portfolio = input.portfolio.map((item) => ({
      id: item.id && p.portfolio.some((x) => x.id === item.id) ? item.id : randomUUID(),
      title: item.title.trim(),
      imageUrl: item.imageUrl,
      url: item.url,
    }));
    p.updatedAt = now;
    stampTrialUnlock(d, userId, now);
    return { ...p };
  });
}

/** Re-check the unlock after a change made elsewhere (photo, payout account, phone). */
export async function refreshTrialUnlock(userId: string): Promise<void> {
  // 100 % also offers the Metwork contract (idempotent, never throws into here).
  await offerContractIfEligible(userId).catch((err) => console.error('[freelancer] contract offer failed', err));
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  const p = data.freelancerProfiles?.find((x) => x.userId === userId);
  if (!user || !p || p.trial?.unlockedAt || computeCompletion(user, p).percent < 100) return;
  const now = new Date().toISOString();
  await db.update((d) => stampTrialUnlock(d, userId, now));
}

// ── Business document ─────────────────────────────────────────────────────

export type SubmitDocumentResult =
  | { ok: true; decision: ReviewDecision }
  | { ok: false; reason: 'DOCUMENT_NOT_ACCEPTED' | 'USER_NOT_FOUND' | 'STORAGE_UNAVAILABLE' };

/**
 * Store the document privately, read it, apply the rules, and record the
 * outcome on both the profile and the user (the badge reads the user field).
 * A new submission replaces the previous one, approved or not.
 */
export async function submitLegalDocument(input: {
  userId: string;
  status: LegalStatus;
  kind: LegalDocumentKind;
  buffer: Buffer;
  mimeType: string;
}): Promise<SubmitDocumentResult> {
  if (!acceptedDocumentsFor(input.status).includes(input.kind)) {
    return { ok: false, reason: 'DOCUMENT_NOT_ACCEPTED' };
  }
  const before = await db.read();
  const user = before.users.find((u) => u.id === input.userId);
  if (!user) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (!isCloudinaryConfigured()) return { ok: false, reason: 'STORAGE_UNAVAILABLE' };

  const now = new Date().toISOString();
  const { publicId } = await uploadAuthenticatedRaw(input.buffer, {
    folder: LEGAL_DOCUMENT_FOLDER,
    publicId: `${input.userId}-${Date.now()}`,
  });

  let extraction = null;
  try {
    extraction = await extractLegalDocument(input.buffer, input.mimeType);
  } catch (err) {
    console.warn('[legal-review] extraction failed, queued for manual review', { userId: input.userId, err: String(err) });
  }

  // Read again for the duplicate check: another account may have submitted
  // the same number while this one was being read.
  const decision = await db.update((d) => {
    const taken = new Set(
      (d.freelancerProfiles ?? [])
        .filter((p) => p.userId !== input.userId && p.legal?.numberKey && p.legal.review.state !== 'REJECTED')
        .map((p) => p.legal!.numberKey!),
    );
    const result = decideLegalReview(extraction, {
      expectedKind: input.kind,
      profileName: user.fullName,
      takenNumberKeys: taken,
    });
    const p = profileIn(d, input.userId, now);
    p.legal = {
      status: input.status,
      documentKind: input.kind,
      documentPublicId: publicId,
      mimeType: input.mimeType,
      submittedAt: now,
      extracted: extraction,
      numberKey: result.numberKey,
      review: { state: result.state, by: 'AUTO', reasons: result.reasons, at: now },
    };
    p.updatedAt = now;
    const u = d.users.find((x) => x.id === input.userId);
    if (u) {
      u.legalVerificationStatus = result.state;
      u.updatedAt = now;
    }
    stampTrialUnlock(d, input.userId, now);
    return result;
  });
  if (decision.state === 'APPROVED') {
    await offerContractIfEligible(input.userId).catch((err) => console.error('[freelancer] contract offer failed', err));
  }
  return { ok: true, decision };
}

/** Admin decision on a queued document. */
export async function decideLegalDocumentByAdmin(input: {
  userId: string;
  adminId: string;
  decision: 'APPROVED' | 'REJECTED';
  note: string | null;
}): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' }> {
  const now = new Date().toISOString();
  const result = await db.update((d) => {
    const p = d.freelancerProfiles?.find((x) => x.userId === input.userId);
    const u = d.users.find((x) => x.id === input.userId);
    if (!p?.legal || !u) return { ok: false, reason: 'NOT_FOUND' } as const;
    p.legal.review = {
      state: input.decision,
      by: input.adminId,
      reasons: input.note ? [input.note] : [],
      at: now,
    };
    p.updatedAt = now;
    u.legalVerificationStatus = input.decision;
    u.updatedAt = now;
    stampTrialUnlock(d, input.userId, now);
    return { ok: true } as const;
  });
  // An approval can be what brings the profile to 100 %: offer the contract now,
  // so the freelancer is notified without having to open the app first.
  if (result.ok && input.decision === 'APPROVED') {
    await offerContractIfEligible(input.userId).catch((err) => console.error('[freelancer] contract offer failed', err));
  }
  return result;
}

/**
 * Best-effort removal of a deleted account's stored document. The record is
 * already gone; a failure here is logged, never surfaced to the deleter.
 */
export async function deleteLegalDocumentFile(publicId: string | null | undefined): Promise<void> {
  if (!publicId || !isCloudinaryConfigured()) return;
  try {
    await destroyAuthenticatedRaw(publicId);
  } catch (err) {
    console.error('[legal-document] could not delete stored file', { publicId, err: String(err) });
  }
}

// ── Premium trial ─────────────────────────────────────────────────────────

export type StartTrialResult =
  | { ok: true; expiresAt: string }
  | {
      ok: false;
      reason: 'NOT_ON_SALE' | 'NOT_UNLOCKED' | 'ALREADY_USED' | 'DOCUMENT_ALREADY_USED' | 'ALREADY_PAID' | 'NOT_FOUND';
    };

/**
 * Start the free Premium month. Once per person: per account, and per
 * business document number across accounts, so new accounts can't farm it.
 * Never charged and never renewed — it simply ends (see renewals).
 */
export async function startPremiumTrial(userId: string, now = new Date()): Promise<StartTrialResult> {
  if (!isFreelancerPremiumOnSale()) return { ok: false, reason: 'NOT_ON_SALE' };
  const nowIso = now.toISOString();
  return db.update((d) => {
    const user = d.users.find((u) => u.id === userId);
    const p = d.freelancerProfiles?.find((x) => x.userId === userId);
    if (!user || user.role !== 'FREELANCER' || !p) return { ok: false, reason: 'NOT_FOUND' } as const;
    // Recomputed here — the stamp alone is not trusted for the grant.
    if (computeCompletion(user, p).percent < 100) return { ok: false, reason: 'NOT_UNLOCKED' } as const;
    if (p.trial?.startedAt) return { ok: false, reason: 'ALREADY_USED' } as const;
    const key = p.legal?.numberKey;
    const usedElsewhere = (d.freelancerProfiles ?? []).some(
      (o) => o.userId !== userId && o.legal?.numberKey === key && !!o.trial?.startedAt,
    );
    if (!key || usedElsewhere) return { ok: false, reason: 'DOCUMENT_ALREADY_USED' } as const;
    if (normalizePlanCode(getEffectiveMembershipCode(user))) return { ok: false, reason: 'ALREADY_PAID' } as const;

    const config = planConfigsFrom(d).find((c) => c.planCode === 'FREELANCER_PREMIUM')!;
    const expiresAt = computePeriodEnd(nowIso, 'MONTHLY');
    const membershipId = randomUUID();
    if (!Array.isArray(d.userMemberships)) d.userMemberships = [];
    for (const m of d.userMemberships) {
      if (m.userId === userId && m.status === 'ACTIVE') {
        m.status = 'CANCELLED';
        m.updatedAt = nowIso;
      }
    }
    d.userMemberships.push({
      id: membershipId,
      userId,
      plan: 'FREELANCER_PREMIUM',
      startsAt: nowIso,
      expiresAt,
      status: 'ACTIVE',
      createdAt: nowIso,
      updatedAt: nowIso,
      basePrice: 0,
      amountCharged: 0,
      promoDiscountPercent: 0,
      spaceDiscountRate: config.spaceDiscountRate,
      consultationDiscountRate: config.consultationDiscountRate,
      monthlyPassCount: 0,
      snapshotAt: nowIso,
      autoRenew: false,
      trial: true,
    });
    user.membershipCode = 'FREELANCER_PREMIUM';
    user.membershipTier = 'FOUNDER';
    user.membershipStartDate = nowIso;
    user.membershipExpiresAt = expiresAt;
    user.membershipRenewalDate = null;
    user.membershipSpaceDiscountRate = config.spaceDiscountRate;
    user.membershipConsultationDiscountRate = config.consultationDiscountRate;
    user.networkCredits = 0;
    user.networkCreditsMax = 0;
    user.networkPassesUsedThisMonth = 0;
    user.updatedAt = nowIso;
    p.trial = { unlockedAt: p.trial?.unlockedAt ?? nowIso, startedAt: nowIso, membershipId };
    p.updatedAt = nowIso;
    return { ok: true, expiresAt } as const;
  });
}
