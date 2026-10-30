/**
 * Refunds — ONE record (`RefundRequestRecord`) and ONE reversal for every paid
 * thing a client can get their money back for.
 *
 *   request     client / owner / admin / system opens it            REQUESTED
 *   accept      admin accepts: the OWNER side of the sale is undone
 *               in the same write that decides where the client is
 *               paid, so nothing can be withdrawn in between
 *                 registered client → credited to their Metwork wallet,
 *                                     emailed                        REFUNDED
 *                 guest             → emailed a link for their account
 *                                                                    AWAITING_ACCOUNT
 *   account     guest gives a RIB/CCP through the link               READY_TO_PAY
 *   paid        admin sends the transfer, attaches the receipt       REFUNDED
 *   reject      admin declines (only before acceptance)              REJECTED
 *
 * What "undo the owner side" means, per owner:
 *   • incubator  — the PAYOUT and COMMISSION ledger rows written at settlement
 *                  are reversed from the incubator manager's wallet.
 *   • consultant — `reverseSaleInDraft`: earning + commission marked REVERSED,
 *                  the money is taken back, anything already withdrawn becomes
 *                  a debt that nets against their next earnings.
 *   • both       — the seat is freed (booking REFUNDED / consultation CANCELLED).
 *
 * The reversal is derived from the ledger rows that actually moved money, never
 * from what the booking "should" have paid, so a refund after a rate change, a
 * partial credit or a half-finished earlier cancel still lands on the right
 * numbers. `db.update` has no rollback, so every check that can refuse runs
 * BEFORE the first write.
 */
import { isConsultationRefundWindowOpen } from '@/lib/refund-window';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  db,
  type BookingRecord,
  type MentorBookingRecord,
  type PayoutAccount,
  type RefundRequestRecord,
  type RefundSourceKind,
  type TransactionRecord,
} from '@/server/db/store';
import { creditRefundInDraft } from '@/server/wallet/service';
import { ensureWalletDraft, findOwningIncubator, findOwningMentor } from '@/server/bookings/incubator-payout';
import { reverseSaleInDraft } from '@/server/mentors/ledger';
import { releaseSlot } from '@/server/mentors/slot-lock';
import { bookingIsManual } from '@/server/bookings/status';
import { isValidPayoutAccountNumber, normalizePayoutAccount } from '@/server/withdrawals/service';
import { sendRefundEmail } from '@/server/notifications/refund-emails';
import { createNotification } from '@/server/notifications/create-notification';
import { notifyAdmins } from '@/server/notifications/notify-admins';
import { normalizeEmailLang } from '@/server/notifications/email';
import { clientEnvVars } from '@/lib/env';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

/** How long the emailed account link stays valid. */
export const ACCOUNT_LINK_TTL_DAYS = 30;

const OPEN_STATUSES = new Set<RefundRequestRecord['status']>(['REQUESTED', 'AWAITING_ACCOUNT', 'READY_TO_PAY']);

/* ───────────────────────────── Source resolution ───────────────────────────── */

export type RefundIneligible = 'NOT_FOUND' | 'NOTHING_PAID' | 'NOT_REFUNDABLE' | 'ALREADY_REFUNDED' | 'TOO_LATE';

interface ResolvedSource {
  kind: RefundSourceKind;
  id: string;
  itemName: string;
  ownerKind: 'INCUBATOR' | 'MENTOR' | null;
  ownerId: string | null;
  /** Everything the client was charged online, integer DZD. */
  amount: number;
  userId: string | null;
  clientName: string;
  clientEmail: string | null;
  locale: 'en' | 'fr' | 'ar';
}

type SourceResult = { ok: true; src: ResolvedSource } | { ok: false; reason: RefundIneligible };

function clientOf(
  d: StoreDraft,
  userId: string | null | undefined,
  fallbackName: string | null | undefined,
  fallbackEmail: string | null | undefined,
  fallbackLocale: string | null | undefined,
) {
  const user = userId ? d.users.find((u) => u.id === userId) ?? null : null;
  return {
    userId: user ? user.id : null,
    clientName: user?.fullName ?? fallbackName ?? '',
    clientEmail: user?.email ?? fallbackEmail ?? null,
    locale: normalizeEmailLang(user?.locale ?? fallbackLocale),
  };
}

function resolveBooking(d: StoreDraft, b: BookingRecord): SourceResult {
  if (b.status === 'REFUNDED') return { ok: false, reason: 'ALREADY_REFUNDED' };
  if (bookingIsManual(b)) return { ok: false, reason: 'NOT_REFUNDABLE' };

  let amount = 0;
  if (b.paymentMethod === 'card') {
    if (!b.settledAt) return { ok: false, reason: 'NOTHING_PAID' };
    amount = b.onlineChargeAmount ?? b.onlinePaidAmount ?? 0;
  } else if (b.paymentMethod === 'wallet') {
    const pay = b.transactionId ? d.transactions.find((t) => t.id === b.transactionId) : null;
    if (!pay || pay.type !== 'PAYMENT') return { ok: false, reason: 'NOTHING_PAID' };
    // The wallet rail's own cancel/decline already paid this back.
    if (pay.status === 'REVERSED' || d.transactions.some((t) => t.reference === `refund-${b.id}` && t.type === 'REFUND')) {
      return { ok: false, reason: 'ALREADY_REFUNDED' };
    }
    amount = Math.abs(pay.amount);
  } else {
    return { ok: false, reason: 'NOT_REFUNDABLE' };
  }
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'NOTHING_PAID' };

  const incubator = findOwningIncubator(d, b.itemKind, b.itemId);
  const mentor = incubator ? null : findOwningMentor(d, b.itemKind, b.itemId);
  return {
    ok: true,
    src: {
      kind: 'BOOKING',
      id: b.id,
      itemName: b.itemName,
      ownerKind: incubator ? 'INCUBATOR' : mentor ? 'MENTOR' : null,
      ownerId: incubator?.id ?? mentor?.id ?? null,
      amount,
      ...clientOf(d, b.userId, b.clientName, b.clientEmail, b.bookingLocale),
    },
  };
}

const CONSULTATION_PAID_STATES = new Set<MentorBookingRecord['status']>([
  'APPROVED', 'CONFIRMED', 'READY', 'AWAITING_LINK', 'COMPLETED', 'CANCELLED',
]);

function resolveConsultation(d: StoreDraft, b: MentorBookingRecord): SourceResult {
  if (b.refundTransactionId) return { ok: false, reason: 'ALREADY_REFUNDED' };
  if (!CONSULTATION_PAID_STATES.has(b.status)) return { ok: false, reason: 'NOTHING_PAID' };
  if (b.chargeType === 'FREE_QUOTA') return { ok: false, reason: 'NOTHING_PAID' };

  const walletTx = b.transactionId ? d.transactions.find((t) => t.id === b.transactionId) : null;
  const paid = b.paymentStatus === 'PAID' || (walletTx != null && walletTx.status === 'COMPLETED');
  if (!paid) return { ok: false, reason: 'NOTHING_PAID' };
  if (walletTx?.status === 'REVERSED') return { ok: false, reason: 'ALREADY_REFUNDED' };

  const amount = b.amountCharged ?? b.guestAmountDue ?? 0;
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, reason: 'NOTHING_PAID' };

  const mentor = (d.mentors ?? []).find((m) => m.id === b.mentorId);
  return {
    ok: true,
    src: {
      kind: 'MENTOR_BOOKING',
      id: b.id,
      itemName: mentor ? `Consultation — ${mentor.fullName}` : 'Consultation',
      ownerKind: 'MENTOR',
      ownerId: b.mentorId,
      amount,
      ...clientOf(d, b.userId, b.userName, b.userEmail, b.guestLocale),
    },
  };
}

function resolveSource(d: StoreDraft, kind: RefundSourceKind, id: string): SourceResult {
  if (kind === 'BOOKING') {
    const b = d.bookings.find((x) => x.id === id);
    return b ? resolveBooking(d, b) : { ok: false, reason: 'NOT_FOUND' };
  }
  const b = (d.mentorBookings ?? []).find((x) => x.id === id);
  return b ? resolveConsultation(d, b) : { ok: false, reason: 'NOT_FOUND' };
}

/* ───────────────────────────── Owner-side reversal ───────────────────────────── */

type Reversal = NonNullable<RefundRequestRecord['reversal']>;

/**
 * Undo what the sale did to its owner and free the seat. Runs on an open draft,
 * writes only, and is idempotent per booking (each ledger row it adds carries a
 * fixed reference that it looks for first).
 */
function reverseOwnerSide(
  d: StoreDraft,
  src: ResolvedSource,
  refundRequestId: string,
  now: string,
  opts: { recoveredOffPlatform: boolean },
): Reversal {
  const out: Reversal = { at: now, ownerKind: src.ownerKind, ownerDebit: 0, commissionReversed: 0, debtAdded: 0, recoveredOffPlatform: 0 };

  if (src.kind === 'BOOKING') {
    const booking = d.bookings.find((b) => b.id === src.id)!;

    if (src.ownerKind === 'INCUBATOR') {
      const incubator = d.incubators.find((i) => i.id === src.ownerId);
      if (incubator?.managerId) {
        const payout = d.transactions.find((t) => t.userId === incubator.managerId && t.reference === `payout-${booking.id}` && t.type === 'PAYOUT');
        const alreadyReversed = d.transactions.some((t) => t.reference === `payout-reversal-${booking.id}`);
        if (payout && !alreadyReversed) {
          const commissionTx = d.transactions.find((t) => t.userId === incubator.managerId && t.reference === `commission-${booking.id}` && t.type === 'COMMISSION');
          const credited = payout.amount;
          const commission = commissionTx ? Math.abs(commissionTx.amount) : 0;
          const wallet = ensureWalletDraft(d, incubator.managerId);
          const push = (amount: number, description: string, reference: string) => {
            wallet.balance += amount;
            wallet.updatedAt = now;
            const tx: TransactionRecord = {
              id: randomUUID(), walletId: wallet.id, userId: incubator.managerId!, type: 'ADJUSTMENT',
              amount, balanceAfter: wallet.balance, status: 'COMPLETED', description, reference,
              provider: 'internal', providerTxnId: null,
              metadata: { bookingId: booking.id, refundRequestId },
              createdAt: now, completedAt: now,
            };
            d.transactions.push(tx);
          };
          // Same two rows the incubator's own cancel writes, so the two paths
          // can never both reverse the same sale.
          push(-credited, `Booking payout reversed — ${booking.itemName}`, `payout-reversal-${booking.id}`);
          if (commission > 0) push(commission, `Platform commission reversed — ${booking.itemName}`, `commission-reversal-${booking.id}`);
          out.ownerDebit = credited - commission;
          out.commissionReversed = commission;
        }
      }
    } else if (src.ownerKind === 'MENTOR' && src.ownerId) {
      const r = reverseSaleInDraft(d, {
        mentorId: src.ownerId, bookingId: booking.id, refundRequestId,
        recoveredOffPlatform: opts.recoveredOffPlatform, description: 'Program sale refunded to the client',
      });
      if (r.ok && !r.replayed) {
        out.ownerDebit = r.reversed;
        out.commissionReversed = booking.commissionAmount ?? 0;
        out.debtAdded = r.debtAdded;
        out.recoveredOffPlatform = r.recoveredOffPlatform;
      }
    }

    booking.status = 'REFUNDED';
    booking.refundRequestId = refundRequestId;
    booking.refundedAt = now;
    booking.updatedAt = now;
    for (const desk of d.deskBookings ?? []) {
      if (desk.bookingId === booking.id && desk.status !== 'CANCELLED') desk.status = 'CANCELLED';
    }
    for (const reg of d.registrations ?? []) {
      if (reg.bookingId === booking.id && reg.status !== 'CANCELLED') { reg.status = 'CANCELLED'; reg.updatedAt = now; }
    }
    return out;
  }

  // MENTOR_BOOKING (consultation)
  const booking = (d.mentorBookings ?? []).find((b) => b.id === src.id)!;
  const r = reverseSaleInDraft(d, {
    mentorId: booking.mentorId, bookingId: booking.id, refundRequestId,
    recoveredOffPlatform: opts.recoveredOffPlatform, description: 'Consultation refunded to the client',
  });
  if (r.ok && !r.replayed) {
    out.ownerDebit = r.reversed;
    out.debtAdded = r.debtAdded;
    out.recoveredOffPlatform = r.recoveredOffPlatform;
    const commission = (d.mentorLedgerTxns ?? []).find((t) => t.mentorId === booking.mentorId && t.reference === `mentor-commission-${booking.id}`);
    out.commissionReversed = Math.max(0, Math.round(Number((commission?.metadata as { platformShare?: number } | undefined)?.platformShare ?? 0)));
  }
  if (booking.status !== 'CANCELLED') {
    booking.status = 'CANCELLED';
    booking.cancelledAt = now;
    booking.cancelledBy = 'admin';
    booking.cancelReason = 'Refunded';
  }
  booking.updatedAt = now;
  return out;
}

/* ───────────────────────────── Tokens ───────────────────────────── */

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

function accountUrl(locale: string, token: string): string {
  return `${clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/${locale}/refund/${token}`;
}

/* ───────────────────────────── Request ───────────────────────────── */

export type RequestRefundResult =
  | { ok: true; request: RefundRequestRecord; replayed: boolean }
  | { ok: false; reason: RefundIneligible };

export async function requestRefund(input: {
  sourceKind: RefundSourceKind;
  sourceId: string;
  reason: string;
  requestedBy: RefundRequestRecord['requestedBy'];
  requestedById?: string | null;
}): Promise<RequestRefundResult> {
  const result = await db.update<RequestRefundResult>((d) => {
    if (!Array.isArray(d.refundRequests)) d.refundRequests = [];
    const open = d.refundRequests.find((r) => r.sourceKind === input.sourceKind && r.sourceId === input.sourceId && OPEN_STATUSES.has(r.status));
    if (open) return { ok: true, request: open, replayed: true };
    if (d.refundRequests.some((r) => r.sourceKind === input.sourceKind && r.sourceId === input.sourceId && r.status === 'REFUNDED')) {
      return { ok: false, reason: 'ALREADY_REFUNDED' };
    }
    const resolved = resolveSource(d, input.sourceKind, input.sourceId);
    if (!resolved.ok) return resolved;
    const { src } = resolved;
    // Clients can only ask until 24h before the session; admins can always open one.
    if (input.sourceKind === 'MENTOR_BOOKING' && input.requestedBy === 'CLIENT') {
      const session = (d.mentorBookings ?? []).find((x) => x.id === input.sourceId);
      if (session && !isConsultationRefundWindowOpen(session)) return { ok: false, reason: 'TOO_LATE' };
    }
    const now = new Date().toISOString();
    const request: RefundRequestRecord = {
      id: randomUUID(),
      sourceKind: src.kind, sourceId: src.id, itemName: src.itemName,
      ownerKind: src.ownerKind, ownerId: src.ownerId,
      amount: src.amount,
      destination: src.userId ? 'WALLET' : 'BANK',
      userId: src.userId, clientName: src.clientName, clientEmail: src.clientEmail, locale: src.locale,
      reason: input.reason.trim().slice(0, 1000),
      requestedBy: input.requestedBy, requestedById: input.requestedById ?? null,
      status: 'REQUESTED', reversal: null,
      createdAt: now, updatedAt: now,
    };
    d.refundRequests.push(request);
    return { ok: true, request, replayed: false };
  });

  if (result.ok && !result.replayed) {
    await notifyAdmins({
      type: 'REFUND_REQUESTED',
      title: 'Refund requested',
      body: `${result.request.amount.toLocaleString('fr-DZ')} DZD — ${result.request.itemName}`,
      href: '/dashboard/admin/payments?tab=refunds',
    });
  }
  return result;
}

/* ───────────────────────────── Accept ───────────────────────────── */

export type AcceptRefundResult =
  | { ok: true; request: RefundRequestRecord; replayed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'NO_CLIENT_EMAIL' | RefundIneligible; status?: RefundRequestRecord['status'] };

export async function acceptRefund(input: {
  id: string;
  adminId: string;
  adminNote?: string | null;
}): Promise<AcceptRefundResult> {
  // Assigned inside the db.update closure; a box keeps TS from narrowing it to null.
  const issued: { token: string | null } = { token: null };

  const result = await db.update<AcceptRefundResult>((d) => {
    const r = (d.refundRequests ?? []).find((x) => x.id === input.id);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status !== 'REQUESTED') {
      // A repeated click on an already-accepted request is a replay, not an error.
      if (r.status === 'AWAITING_ACCOUNT' || r.status === 'READY_TO_PAY' || r.status === 'REFUNDED') {
        return { ok: true, request: r, replayed: true };
      }
      return { ok: false, reason: 'WRONG_STATE', status: r.status };
    }

    const resolved = resolveSource(d, r.sourceKind, r.sourceId);
    if (!resolved.ok) return resolved;
    const { src } = resolved;

    // Everything that can refuse has run once we pass this line.
    const toWallet = Boolean(src.userId);
    if (!toWallet && !src.clientEmail) return { ok: false, reason: 'NO_CLIENT_EMAIL' };

    const now = new Date().toISOString();
    r.amount = src.amount;
    r.destination = toWallet ? 'WALLET' : 'BANK';
    r.userId = src.userId;
    r.clientName = src.clientName;
    r.clientEmail = src.clientEmail;
    r.locale = src.locale;
    r.reversal = reverseOwnerSide(d, src, r.id, now, { recoveredOffPlatform: false });
    r.processedByAdminId = input.adminId;
    if (input.adminNote !== undefined) r.adminNote = input.adminNote;
    r.updatedAt = now;

    if (toWallet) {
      const tx = creditRefundInDraft(d, {
        userId: src.userId!, amount: src.amount,
        description: `Refund — ${src.itemName}`,
        reference: `refund-request-${r.id}`,
        metadata: { refundRequestId: r.id, sourceKind: src.kind, sourceId: src.id },
      });
      r.walletRefundTxnId = tx?.id ?? null;
      if (src.kind === 'MENTOR_BOOKING') {
        const mb = (d.mentorBookings ?? []).find((b) => b.id === src.id);
        if (mb) {
          mb.refundTransactionId = tx?.id ?? mb.refundTransactionId ?? null;
          const orig = mb.transactionId ? d.transactions.find((t) => t.id === mb.transactionId) : null;
          if (orig) { orig.status = 'REVERSED'; orig.completedAt = now; }
        }
      }
      r.status = 'REFUNDED';
      r.refundedAt = now;
    } else {
      issued.token = newToken();
      r.tokenHash = hashToken(issued.token);
      r.tokenExpiresAt = new Date(Date.now() + ACCOUNT_LINK_TTL_DAYS * 86_400_000).toISOString();
      r.status = 'AWAITING_ACCOUNT';
    }
    return { ok: true, request: r, replayed: false };
  });

  if (!result.ok || result.replayed) return result;
  const r = result.request;

  // Free the consultation slot hold, if any (idempotent, non-blocking).
  if (r.sourceKind === 'MENTOR_BOOKING') {
    await releaseSlot(r.sourceId).catch(() => undefined);
  }

  if (r.destination === 'WALLET') {
    if (r.clientEmail) {
      await sendRefundEmail({
        kind: 'WALLET_CREDITED', to: r.clientEmail, lang: r.locale, clientName: r.clientName,
        itemName: r.itemName, amount: r.amount,
        walletUrl: `${clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/${r.locale}/dashboard/entrepreneur/wallet`,
      });
    }
    if (r.userId) {
      await createNotification({
        userId: r.userId, type: 'REFUND_UPDATE', title: 'Refund received',
        body: `${r.amount.toLocaleString('fr-DZ')} DZD were added to your Metwork wallet (${r.itemName}).`,
        href: '/dashboard',
      });
    }
  } else if (issued.token && r.clientEmail) {
    await sendRefundEmail({
      kind: 'ACCOUNT_REQUEST', to: r.clientEmail, lang: r.locale, clientName: r.clientName,
      itemName: r.itemName, amount: r.amount, accountUrl: accountUrl(r.locale, issued.token), expiresAt: r.tokenExpiresAt,
    });
  }
  return result;
}

/** Issue a fresh account link (old one stops working) and email it again. */
export async function resendAccountLink(id: string): Promise<{ ok: true } | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'NO_CLIENT_EMAIL' }> {
  const issued: { token: string | null } = { token: null };
  const r = await db.update<RefundRequestRecord | 'NOT_FOUND' | 'WRONG_STATE' | 'NO_CLIENT_EMAIL'>((d) => {
    const rec = (d.refundRequests ?? []).find((x) => x.id === id);
    if (!rec) return 'NOT_FOUND';
    if (rec.status !== 'AWAITING_ACCOUNT' && rec.status !== 'READY_TO_PAY') return 'WRONG_STATE';
    if (!rec.clientEmail) return 'NO_CLIENT_EMAIL';
    issued.token = newToken();
    rec.tokenHash = hashToken(issued.token);
    rec.tokenExpiresAt = new Date(Date.now() + ACCOUNT_LINK_TTL_DAYS * 86_400_000).toISOString();
    rec.updatedAt = new Date().toISOString();
    return rec;
  });
  if (typeof r === 'string') return { ok: false, reason: r };
  await sendRefundEmail({
    kind: 'ACCOUNT_REQUEST', to: r.clientEmail!, lang: r.locale, clientName: r.clientName,
    itemName: r.itemName, amount: r.amount, accountUrl: accountUrl(r.locale, issued.token!), expiresAt: r.tokenExpiresAt,
  });
  return { ok: true };
}

/* ───────────────────────────── Guest account page ───────────────────────────── */

export type AccountLinkView =
  | { state: 'INVALID' }
  | { state: 'EXPIRED' }
  | { state: 'DONE'; amount: number; itemName: string }
  | { state: 'OPEN'; amount: number; itemName: string; clientName: string; alreadySubmitted: boolean };

function findByToken(d: StoreDraft, token: string): RefundRequestRecord | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const h = hashToken(token);
  return (d.refundRequests ?? []).find((r) => r.tokenHash === h) ?? null;
}

export async function getAccountLinkView(token: string): Promise<AccountLinkView> {
  const d = await db.read();
  const r = findByToken(d as StoreDraft, token);
  if (!r) return { state: 'INVALID' };
  if (r.status === 'REFUNDED') return { state: 'DONE', amount: r.amount, itemName: r.itemName };
  if (r.status !== 'AWAITING_ACCOUNT' && r.status !== 'READY_TO_PAY') return { state: 'INVALID' };
  if (r.tokenExpiresAt && new Date(r.tokenExpiresAt).getTime() < Date.now()) return { state: 'EXPIRED' };
  return { state: 'OPEN', amount: r.amount, itemName: r.itemName, clientName: r.clientName, alreadySubmitted: r.status === 'READY_TO_PAY' };
}

export type SubmitAccountResult =
  | { ok: true }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'INVALID_ACCOUNT_NUMBER' | 'INVALID_HOLDER_NAME' };

export async function submitRefundAccount(token: string, account: PayoutAccount): Promise<SubmitAccountResult> {
  const normalized = normalizePayoutAccount(account);
  if (!isValidPayoutAccountNumber(normalized.accountNumber)) return { ok: false, reason: 'INVALID_ACCOUNT_NUMBER' };
  if (normalized.holderName.length < 2 || normalized.holderName.length > 120) return { ok: false, reason: 'INVALID_HOLDER_NAME' };

  const r = await db.update<RefundRequestRecord | 'INVALID' | 'EXPIRED'>((d) => {
    const rec = findByToken(d, token);
    if (!rec || (rec.status !== 'AWAITING_ACCOUNT' && rec.status !== 'READY_TO_PAY')) return 'INVALID';
    if (rec.tokenExpiresAt && new Date(rec.tokenExpiresAt).getTime() < Date.now()) return 'EXPIRED';
    const now = new Date().toISOString();
    rec.payoutAccount = normalized;
    rec.accountSubmittedAt = now;
    rec.status = 'READY_TO_PAY';
    rec.updatedAt = now;
    return rec;
  });
  if (typeof r === 'string') return { ok: false, reason: r };

  if (r.clientEmail) {
    await sendRefundEmail({ kind: 'ACCOUNT_RECEIVED', to: r.clientEmail, lang: r.locale, clientName: r.clientName, itemName: r.itemName, amount: r.amount });
  }
  await notifyAdmins({
    type: 'REFUND_UPDATE',
    title: 'Refund account received',
    body: `${r.amount.toLocaleString('fr-DZ')} DZD to pay — ${r.itemName}`,
    href: '/dashboard/admin/payments?tab=refunds',
  });
  return { ok: true };
}

/* ───────────────────────────── Pay / reject ───────────────────────────── */

export type MarkPaidResult =
  | { ok: true; request: RefundRequestRecord; replayed: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' | 'INVALID_ACCOUNT_NUMBER' | 'INVALID_HOLDER_NAME' };

/** The admin sent the transfer. `account` lets the admin supply the details the client gave by phone. */
export async function markRefundPaid(input: {
  id: string;
  adminId: string;
  receiptUrl?: string | null;
  transferReference?: string | null;
  account?: PayoutAccount | null;
}): Promise<MarkPaidResult> {
  const account = input.account ? normalizePayoutAccount(input.account) : null;
  if (account) {
    if (!isValidPayoutAccountNumber(account.accountNumber)) return { ok: false, reason: 'INVALID_ACCOUNT_NUMBER' };
    if (account.holderName.length < 2) return { ok: false, reason: 'INVALID_HOLDER_NAME' };
  }

  const result = await db.update<MarkPaidResult>((d) => {
    const r = (d.refundRequests ?? []).find((x) => x.id === input.id);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status === 'REFUNDED') return { ok: true, request: r, replayed: true };
    const canForce = r.status === 'AWAITING_ACCOUNT' && account != null;
    if (r.destination !== 'BANK' || (r.status !== 'READY_TO_PAY' && !canForce)) return { ok: false, reason: 'WRONG_STATE' };
    const now = new Date().toISOString();
    if (account) r.payoutAccount = account;
    r.status = 'REFUNDED';
    r.refundedAt = now;
    r.receiptUrl = input.receiptUrl ?? r.receiptUrl ?? null;
    r.transferReference = input.transferReference?.trim() || r.transferReference || null;
    r.processedByAdminId = input.adminId;
    r.tokenHash = null; // the link is dead once the money is sent
    r.updatedAt = now;
    return { ok: true, request: r, replayed: false };
  });

  if (result.ok && !result.replayed && result.request.clientEmail) {
    await sendRefundEmail({
      kind: 'TRANSFER_SENT', to: result.request.clientEmail, lang: result.request.locale,
      clientName: result.request.clientName, itemName: result.request.itemName, amount: result.request.amount,
      transferReference: result.request.transferReference,
    });
  }
  return result;
}

export async function rejectRefund(input: {
  id: string;
  adminId: string;
  reason: string;
}): Promise<{ ok: true; request: RefundRequestRecord; replayed: boolean } | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' }> {
  const result = await db.update<{ ok: true; request: RefundRequestRecord; replayed: boolean } | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATE' }>((d) => {
    const r = (d.refundRequests ?? []).find((x) => x.id === input.id);
    if (!r) return { ok: false, reason: 'NOT_FOUND' };
    if (r.status === 'REJECTED') return { ok: true, request: r, replayed: true };
    if (r.status !== 'REQUESTED') return { ok: false, reason: 'WRONG_STATE' };
    const now = new Date().toISOString();
    r.status = 'REJECTED';
    r.adminNote = input.reason.trim().slice(0, 1000);
    r.processedByAdminId = input.adminId;
    r.updatedAt = now;
    return { ok: true, request: r, replayed: false };
  });

  if (result.ok && !result.replayed) {
    const r = result.request;
    if (r.clientEmail) {
      await sendRefundEmail({ kind: 'DECLINED', to: r.clientEmail, lang: r.locale, clientName: r.clientName, itemName: r.itemName, amount: r.amount, reason: r.adminNote });
    }
    if (r.userId) {
      await createNotification({
        userId: r.userId, type: 'REFUND_UPDATE', title: 'Refund request declined',
        body: r.adminNote ? `${r.itemName}: ${r.adminNote}` : r.itemName, href: '/dashboard',
      });
    }
  }
  return result;
}

/* ───────────────────────────── Refund settled by hand before this existed ───────────────────────────── */

/**
 * Record a refund the admin already paid out of pocket: the owner side is
 * reversed and the request is stored as REFUNDED + `paidOffPlatform`, with no
 * wallet credit and no email to the client. `recoveredOffPlatform` says the
 * consultant already sent Metwork the sale amount back, so their wallet is left
 * as it is and no debt is recorded.
 */
export async function recordOffPlatformRefund(input: {
  sourceKind: RefundSourceKind;
  sourceId: string;
  adminId: string;
  reason: string;
  recoveredOffPlatform: boolean;
}): Promise<{ ok: true; request: RefundRequestRecord } | { ok: false; reason: RefundIneligible }> {
  return db.update((d) => {
    if (!Array.isArray(d.refundRequests)) d.refundRequests = [];
    const resolved = resolveSource(d, input.sourceKind, input.sourceId);
    if (!resolved.ok) return resolved;
    const { src } = resolved;
    const now = new Date().toISOString();
    const id = randomUUID();
    const reversal = reverseOwnerSide(d, src, id, now, { recoveredOffPlatform: input.recoveredOffPlatform });
    const request: RefundRequestRecord = {
      id, sourceKind: src.kind, sourceId: src.id, itemName: src.itemName,
      ownerKind: src.ownerKind, ownerId: src.ownerId, amount: src.amount,
      destination: 'BANK', userId: src.userId, clientName: src.clientName, clientEmail: src.clientEmail, locale: src.locale,
      reason: input.reason, requestedBy: 'ADMIN', requestedById: input.adminId,
      status: 'REFUNDED', reversal, processedByAdminId: input.adminId, paidOffPlatform: true,
      createdAt: now, updatedAt: now, refundedAt: now,
    };
    d.refundRequests.push(request);
    return { ok: true as const, request };
  });
}

/* ───────────────────────────── Admin list ───────────────────────────── */

export interface RefundRow extends Omit<RefundRequestRecord, 'tokenHash' | 'payoutAccount'> {
  /** Last four digits only; the full number is returned by `getRefundAccount`. */
  accountMasked: string | null;
  accountType: 'bank' | 'ccp' | null;
  accountHolder: string | null;
  linkExpired: boolean;
  /** What accepting would do right now (only meaningful while REQUESTED). */
  preview: null | { ownerKind: 'INCUBATOR' | 'MENTOR' | null; ownerDebit: number; mentorAvailable: number | null; destination: 'WALLET' | 'BANK' };
}

export async function listRefundRows(): Promise<RefundRow[]> {
  const d = (await db.read()) as StoreDraft;
  const rows = [...(d.refundRequests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return rows.map((r) => {
    const { tokenHash: _t, payoutAccount, ...rest } = r;
    void _t;
    let preview: RefundRow['preview'] = null;
    if (r.status === 'REQUESTED') {
      const res = resolveSource(d, r.sourceKind, r.sourceId);
      if (res.ok) {
        let ownerDebit = 0;
        let mentorAvailable: number | null = null;
        if (res.src.ownerKind === 'MENTOR' && res.src.ownerId) {
          const earning = (d.mentorLedgerTxns ?? []).find((t) => t.mentorId === res.src.ownerId && t.reference === `mentor-earning-${res.src.id}`);
          ownerDebit = earning && earning.status !== 'REVERSED' ? Math.max(0, earning.amount) : 0;
          mentorAvailable = (d.mentorWallets ?? []).find((w) => w.mentorId === res.src.ownerId)?.availableBalance ?? 0;
        } else if (res.src.ownerKind === 'INCUBATOR') {
          const inc = d.incubators.find((i) => i.id === res.src.ownerId);
          const payout = d.transactions.find((t) => t.userId === inc?.managerId && t.reference === `payout-${res.src.id}`);
          const comm = d.transactions.find((t) => t.userId === inc?.managerId && t.reference === `commission-${res.src.id}`);
          const reversed = d.transactions.some((t) => t.reference === `payout-reversal-${res.src.id}`);
          ownerDebit = payout && !reversed ? payout.amount - (comm ? Math.abs(comm.amount) : 0) : 0;
        }
        preview = { ownerKind: res.src.ownerKind, ownerDebit, mentorAvailable, destination: res.src.userId ? 'WALLET' : 'BANK' };
      }
    }
    return {
      ...rest,
      accountMasked: payoutAccount ? `****${payoutAccount.accountNumber.slice(-4)}` : null,
      accountType: payoutAccount?.accountType ?? null,
      accountHolder: payoutAccount?.holderName ?? null,
      linkExpired: Boolean(r.tokenExpiresAt && new Date(r.tokenExpiresAt).getTime() < Date.now() && r.status === 'AWAITING_ACCOUNT'),
      preview,
    };
  });
}

/** Full account details, for the admin who is about to send the transfer. */
export async function getRefundAccount(id: string): Promise<PayoutAccount | null> {
  const d = await db.read();
  return (d.refundRequests ?? []).find((r) => r.id === id)?.payoutAccount ?? null;
}

/** Pre-flight for a client or owner who wants to ask: is there anything to refund? */
export async function checkRefundable(kind: RefundSourceKind, id: string): Promise<{ ok: true; amount: number } | { ok: false; reason: RefundIneligible }> {
  const d = (await db.read()) as StoreDraft;
  const r = resolveSource(d, kind, id);
  return r.ok ? { ok: true, amount: r.src.amount } : r;
}
