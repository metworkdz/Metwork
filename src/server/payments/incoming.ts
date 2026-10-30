/**
 * Admin view of money coming IN through Metwork — built from records that
 * already exist (bookings, consultations, ledgers, refund requests), so it needs
 * no store of its own and can never disagree with settlement.
 *
 * It exists because card payments to a consultant or incubator touch only the
 * owner's ledger: the old overview counted wallet payments alone, so a paid
 * consultant program moved none of its figures.
 */
import { db, type DbShape } from '@/server/db/store';
import { findOwningIncubator, findOwningMentor } from '@/server/bookings/incubator-payout';

type Draft = Parameters<Parameters<typeof db.update>[0]>[0];

export type IncomingChannel = 'CARD' | 'STRIPE' | 'WALLET';
export type IncomingStatus = 'PAID' | 'REFUNDED' | 'REFUND_PENDING';

export interface IncomingRow {
  id: string;
  kind: 'BOOKING' | 'MENTOR_BOOKING';
  at: string;
  payer: string;
  payerEmail: string | null;
  guest: boolean;
  item: string;
  itemKind: string;
  ownerName: string;
  ownerKind: 'INCUBATOR' | 'MENTOR' | null;
  channel: IncomingChannel;
  providerRef: string | null;
  gross: number;
  fee: number;
  net: number;
  status: IncomingStatus;
  /** An admin can open a refund for it. */
  refundable: boolean;
}

export interface IncomingSummary {
  monthKey: string;
  collectedThisMonth: number;
  commissionThisMonth: number;
  refundedThisMonth: number;
  openRefunds: number;
  owedToIncubators: number;
  owedToConsultants: number;
  consultantDebt: number;
}

export interface IncomingView {
  rows: IncomingRow[];
  summary: IncomingSummary;
}

const monthKeyOf = (iso: string) => iso.slice(0, 7);

export function buildIncomingView(d: DbShape, now = new Date()): IncomingView {
  const draft = d as unknown as Draft;
  const refunds = d.refundRequests ?? [];
  const stateOf = (kind: IncomingRow['kind'], id: string, status: string): { status: IncomingStatus; refundable: boolean } => {
    const rs = refunds.filter((r) => r.sourceKind === kind && r.sourceId === id);
    if (rs.some((r) => r.status === 'REFUNDED') || status === 'REFUNDED') return { status: 'REFUNDED', refundable: false };
    if (rs.some((r) => r.status !== 'REJECTED')) return { status: 'REFUND_PENDING', refundable: false };
    return { status: 'PAID', refundable: true };
  };

  const rows: IncomingRow[] = [];

  for (const b of d.bookings) {
    let gross = 0;
    let channel: IncomingChannel | null = null;
    if (b.paymentMethod === 'card' && b.settledAt) {
      gross = b.onlineChargeAmount ?? b.onlinePaidAmount ?? 0;
      channel = 'CARD';
    } else if (b.paymentMethod === 'wallet' && b.transactionId) {
      const tx = d.transactions.find((t) => t.id === b.transactionId);
      if (tx?.type === 'PAYMENT') { gross = Math.abs(tx.amount); channel = 'WALLET'; }
    }
    if (!channel || gross <= 0) continue;
    const incubator = findOwningIncubator(draft, b.itemKind, b.itemId);
    const mentor = incubator ? null : findOwningMentor(draft, b.itemKind, b.itemId);
    const user = b.userId ? d.users.find((u) => u.id === b.userId) : null;
    const fee = (b.commissionAmount ?? 0) + (b.payerFeeAmount ?? 0);
    const st = stateOf('BOOKING', b.id, b.status);
    rows.push({
      id: b.id, kind: 'BOOKING', at: b.settledAt ?? b.createdAt,
      payer: user?.fullName ?? b.clientName ?? '—', payerEmail: user?.email ?? b.clientEmail ?? null, guest: !user,
      item: b.itemName, itemKind: b.itemKind,
      ownerName: incubator?.name ?? mentor?.fullName ?? b.vendorName ?? '—',
      ownerKind: incubator ? 'INCUBATOR' : mentor ? 'MENTOR' : null,
      channel, providerRef: b.paymentProviderRef ?? null,
      gross, fee, net: gross - fee, ...st,
    });
  }

  for (const b of d.mentorBookings ?? []) {
    if (b.chargeType === 'FREE_QUOTA') continue;
    const walletTx = b.transactionId ? d.transactions.find((t) => t.id === b.transactionId) : null;
    const paid = b.paymentStatus === 'PAID' || walletTx?.status === 'COMPLETED' || walletTx?.status === 'REVERSED';
    const gross = b.amountCharged ?? b.guestAmountDue ?? 0;
    if (!paid || gross <= 0) continue;
    const mentor = (d.mentors ?? []).find((m) => m.id === b.mentorId);
    const user = b.userId ? d.users.find((u) => u.id === b.userId) : null;
    const commission = (d.mentorLedgerTxns ?? []).find((t) => t.mentorId === b.mentorId && t.reference === `mentor-commission-${b.id}`);
    const share = Number((commission?.metadata as { platformShare?: number } | undefined)?.platformShare ?? 0);
    const channel: IncomingChannel = b.paymentProvider === 'STRIPE' ? 'STRIPE' : b.paymentProvider === 'SLICKPAY' ? 'CARD' : 'WALLET';
    const refunded = Boolean(b.refundTransactionId);
    const st = refunded ? { status: 'REFUNDED' as const, refundable: false } : stateOf('MENTOR_BOOKING', b.id, b.status);
    rows.push({
      id: b.id, kind: 'MENTOR_BOOKING', at: b.updatedAt ?? b.createdAt,
      payer: user?.fullName ?? b.userName, payerEmail: user?.email ?? b.userEmail, guest: !user,
      item: 'Consultation', itemKind: 'CONSULTATION',
      ownerName: mentor?.fullName ?? '—', ownerKind: 'MENTOR',
      channel, providerRef: b.paymentProviderRef ?? null,
      gross, fee: share, net: gross - share, ...st,
    });
  }

  rows.sort((a, b) => b.at.localeCompare(a.at));

  const monthKey = monthKeyOf(now.toISOString());
  const live = rows.filter((r) => r.status !== 'REFUNDED' && monthKeyOf(r.at) === monthKey);
  const incubatorManagers = new Set(d.incubators.map((i) => i.managerId).filter(Boolean));
  const refundedThisMonth = refunds
    .filter((r) => r.status === 'REFUNDED' && !r.paidOffPlatform && monthKeyOf(r.refundedAt ?? r.updatedAt) === monthKey)
    .reduce((s, r) => s + r.amount, 0);

  return {
    rows,
    summary: {
      monthKey,
      collectedThisMonth: live.reduce((s, r) => s + r.gross, 0),
      commissionThisMonth: live.reduce((s, r) => s + r.fee, 0),
      refundedThisMonth,
      openRefunds: refunds.filter((r) => r.status === 'REQUESTED' || r.status === 'AWAITING_ACCOUNT' || r.status === 'READY_TO_PAY').length,
      owedToIncubators: d.wallets.filter((w) => w.status === 'ACTIVE' && incubatorManagers.has(w.userId)).reduce((s, w) => s + Math.max(0, w.balance), 0),
      owedToConsultants: (d.mentorWallets ?? []).reduce((s, w) => s + w.availableBalance + w.pendingBalance, 0),
      consultantDebt: (d.mentorWallets ?? []).reduce((s, w) => s + (w.debtBalance ?? 0), 0),
    },
  };
}

export async function getIncomingView(): Promise<IncomingView> {
  return buildIncomingView(await db.read());
}
