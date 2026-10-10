/**
 * Crediting an incubator for money a client paid through Metwork — ONE place.
 *
 * Two rails settle an incubator-owned SPACE / PROGRAM / EVENT booking: the card
 * checkout (`card-payment.ts`) and the Metwork wallet (`service.ts`). Both move
 * the incubator's wallet the same way:
 *
 *   +amount      (PAYOUT — the money received through the platform)
 *   −commission  (COMMISSION — receiver cut on that amount, FLAT/Pro exempt)
 *
 * The wallet rail used to hold the money in escrow until the incubator pressed
 * a Confirm button the dashboard no longer shows, and then paid out the full
 * amount with no commission — so a paid client looked unpaid, and the two rails
 * paid the same incubator different net amounts for the same seat. Keeping the
 * movement here is what stops them drifting apart again.
 *
 * Synchronous on a store draft: callers run it inside the `db.update` that
 * confirms the booking, so the credit and the CONFIRMED transition commit
 * together.
 */
import { randomUUID } from 'node:crypto';
import type {
  db,
  BookingItemKind,
  BookingRecord,
  IncubatorRecord,
  TransactionRecord,
  WalletRecord,
} from '@/server/db/store';
import { computeCommission, type ProviderPlan } from '@/server/payments/commission';
import { getEffectiveSubscriptionCode } from '@/server/incubator/service';

type StoreDraft = Parameters<Parameters<typeof db.update>[0]>[0];

export function ensureWalletDraft(d: StoreDraft, userId: string): WalletRecord {
  let wallet = d.wallets.find((w) => w.userId === userId);
  if (!wallet) {
    const now = new Date().toISOString();
    wallet = {
      id: randomUUID(),
      userId,
      balance: 0,
      currency: 'DZD',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };
    d.wallets.push(wallet);
  }
  return wallet;
}

/** Resolve the incubator record that owns a SPACE / PROGRAM / EVENT. */
export function findOwningIncubator(
  d: StoreDraft,
  kind: BookingItemKind,
  itemId: string,
): IncubatorRecord | null {
  let incubatorId: string | undefined;
  if (kind === 'SPACE') incubatorId = d.spaces?.find((s) => s.id === itemId)?.incubatorId;
  // A consultant-owned program has no incubatorId (null) and therefore no
  // incubator wallet to settle into — it resolves to no owning incubator here.
  // Consultant earnings use the PARALLEL mentorId-keyed ledger, which this
  // incubator-wallet settlement path deliberately does not touch.
  else if (kind === 'PROGRAM') incubatorId = d.programs?.find((p) => p.id === itemId)?.incubatorId ?? undefined;
  else incubatorId = d.events?.find((e) => e.id === itemId)?.incubatorId;
  if (!incubatorId) return null;
  return d.incubators.find((i) => i.id === incubatorId) ?? null;
}

/**
 * Pay the incubator for `amount` received on `booking`, net of the receiver
 * commission. Stamps `booking.commissionRate` / `commissionAmount` with what
 * was actually taken, which is what a later reversal gives back.
 *
 * The caller owns idempotency (card: the `settledAt` claim; wallet: the booking
 * is created in the same mutation). A frozen wallet is not credited, as before.
 */
export function creditIncubatorPayoutDraft(
  d: StoreDraft,
  input: {
    booking: BookingRecord;
    incubator: IncubatorRecord & { managerId: string };
    /** The base money received through the platform (never a cash remainder). */
    amount: number;
    providerRef: string | null;
    now: string;
  },
): void {
  const { booking, incubator, amount, providerRef, now } = input;
  // Receiver commission is taken on the amount received through the platform
  // — never a cash remainder — so the net credited is always ≥ 0.
  const providerPlan: ProviderPlan = getEffectiveSubscriptionCode(incubator);
  const quote = computeCommission({
    transactionType: 'PAYMENT',
    providerPlan,
    baseAmount: amount,
    config: d.meta?.platformConfig,
  });
  const commission = quote.receiverCommission;
  booking.commissionRate = quote.receiverRate;
  booking.commissionAmount = commission;

  const wallet = ensureWalletDraft(d, incubator.managerId);
  if (wallet.status === 'FROZEN') return;

  if (amount > 0) {
    wallet.balance += amount;
    wallet.updatedAt = now;
    const payoutTx: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: incubator.managerId,
      type: 'PAYOUT',
      amount,
      balanceAfter: wallet.balance,
      status: 'COMPLETED',
      description: `Booking online payment — ${booking.itemName}`,
      reference: `payout-${booking.id}`,
      provider: 'internal',
      providerTxnId: providerRef,
      metadata: {
        bookingId: booking.id,
        customerId: booking.userId,
        paymentMode: booking.paymentMode,
        paymentMethod: booking.paymentMethod,
        total: booking.totalAmount,
      },
      createdAt: now,
      completedAt: now,
    };
    d.transactions.push(payoutTx);
  }

  if (commission > 0) {
    wallet.balance -= commission;
    wallet.updatedAt = now;
    const commissionTx: TransactionRecord = {
      id: randomUUID(),
      walletId: wallet.id,
      userId: incubator.managerId,
      type: 'COMMISSION',
      amount: -commission,
      balanceAfter: wallet.balance,
      status: 'COMPLETED',
      description: `Platform commission — ${booking.itemName}`,
      reference: `commission-${booking.id}`,
      provider: 'internal',
      providerTxnId: null,
      metadata: {
        bookingId: booking.id,
        total: booking.totalAmount,
        base: amount,
        rate: quote.receiverRate,
        payerFee: booking.payerFeeAmount ?? 0,
        payerRate: booking.payerFeeRate ?? 0,
        platformTake: quote.platformTake,
      },
      createdAt: now,
      completedAt: now,
    };
    d.transactions.push(commissionTx);
  }
}
