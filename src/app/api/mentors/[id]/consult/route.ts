/**
 * POST /api/mentors/:id/consult
 * Book a paid 30-min consultation with a mentor.
 *
 * Pricing & free-quota logic:
 *   ENTREPRENEUR membership → 1 free session/month
 *   STARTUP membership      → 3 free sessions/month
 *   All others              → always charged 3 000 DZD
 *
 * Free sessions are counted per calendar month (UTC).
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiSession } from '@/server/auth/api-guards';
import { db, type MentorConsultationRecord, type TransactionRecord } from '@/server/db/store';
import { findMentorById } from '@/server/mentors/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { CONSULTATION_QUOTA, getEffectiveMembershipCode } from '@/server/memberships/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONSULTATION_PRICE = 3_000; // DZD

/** @deprecated Use CONSULTATION_QUOTA from memberships/service.ts instead */
const FREE_QUOTA: Record<string, number> = CONSULTATION_QUOTA;

const schema = z.object({
  message: z.string().min(10).max(1000),
});

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: mentorId } = await params;
  const mentor = await findMentorById(mentorId);
  if (!mentor) return jsonError(404, 'NOT_FOUND', 'Mentor not found');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const quotaMonth = currentQuotaMonth();
  const userId = guard.user.id;
  const effectiveCode = getEffectiveMembershipCode(guard.user);
  const freeQuota = FREE_QUOTA[effectiveCode] ?? 0;

  const result = await db.update((d) => {
    if (!Array.isArray(d.mentorConsultations)) d.mentorConsultations = [];

    // Count free-quota sessions used this month.
    const usedThisMonth = d.mentorConsultations.filter(
      (c) =>
        c.userId === userId &&
        c.quotaMonth === quotaMonth &&
        c.chargeType === 'FREE_QUOTA' &&
        c.status !== 'CANCELLED',
    ).length;

    const isFree = usedThisMonth < freeQuota;
    const amountCharged = isFree ? 0 : CONSULTATION_PRICE;
    const now = new Date().toISOString();

    // If paid, debit wallet atomically.
    let transactionId: string | null = null;
    if (!isFree) {
      let wallet = d.wallets.find((w) => w.userId === userId);
      if (!wallet) {
        wallet = {
          id: randomUUID(),
          userId,
          balance: 0,
          currency: 'DZD' as const,
          status: 'ACTIVE' as const,
          createdAt: now,
          updatedAt: now,
        };
        d.wallets.push(wallet);
      }
      if (wallet.status === 'FROZEN') return 'WALLET_FROZEN' as const;
      if (wallet.balance < CONSULTATION_PRICE) {
        return { reason: 'INSUFFICIENT_FUNDS', balance: wallet.balance } as const;
      }

      wallet.balance -= CONSULTATION_PRICE;
      wallet.updatedAt = now;

      const tx: TransactionRecord = {
        id: randomUUID(),
        walletId: wallet.id,
        userId,
        type: 'PAYMENT',
        amount: -CONSULTATION_PRICE,
        balanceAfter: wallet.balance,
        status: 'COMPLETED',
        description: `Consultation — ${mentor.fullName}`,
        reference: `consult-${randomUUID()}`,
        provider: 'internal',
        providerTxnId: null,
        metadata: { mentorId, type: 'MENTOR_CONSULTATION' },
        createdAt: now,
        completedAt: now,
      };
      d.transactions.push(tx);
      transactionId = tx.id;
    }

    const consultation: MentorConsultationRecord = {
      id: randomUUID(),
      mentorId,
      mentorName: mentor.fullName,
      userId,
      chargeType: isFree ? 'FREE_QUOTA' : 'PAID',
      amountCharged,
      transactionId,
      status: 'CONFIRMED',
      quotaMonth,
      message: input.message,
      createdAt: now,
      updatedAt: now,
    };
    d.mentorConsultations.push(consultation);

    return {
      consultation,
      freeSessionsUsed: isFree ? usedThisMonth + 1 : usedThisMonth,
      freeQuota,
    };
  });

  if (result === 'WALLET_FROZEN') {
    return jsonError(409, 'WALLET_FROZEN', 'Your wallet is frozen. Contact support.');
  }
  if (typeof result === 'object' && 'reason' in result && result.reason === 'INSUFFICIENT_FUNDS') {
    return jsonError(422, 'INSUFFICIENT_FUNDS', 'Insufficient wallet balance', {
      balance: result.balance,
      required: CONSULTATION_PRICE,
    });
  }

  const { consultation, freeSessionsUsed, freeQuota: quota } = result as {
    consultation: MentorConsultationRecord;
    freeSessionsUsed: number;
    freeQuota: number;
  };

  return json(
    {
      id: consultation.id,
      chargeType: consultation.chargeType,
      amountCharged: consultation.amountCharged,
      freeSessionsUsed,
      freeQuota: quota,
    },
    { status: 201 },
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiSession();
  if (!guard.ok) return guard.response;

  const { id: mentorId } = await params;
  const quotaMonth = currentQuotaMonth();
  const userId = guard.user.id;
  const effectiveCode = getEffectiveMembershipCode(guard.user);
  const freeQuota = FREE_QUOTA[effectiveCode] ?? 0;

  const data = await db.read();
  const consultations = (data.mentorConsultations ?? []).filter(
    (c) => c.mentorId === mentorId && c.userId === userId,
  );
  const usedThisMonth = (data.mentorConsultations ?? []).filter(
    (c) =>
      c.userId === userId &&
      c.quotaMonth === quotaMonth &&
      c.chargeType === 'FREE_QUOTA' &&
      c.status !== 'CANCELLED',
  ).length;

  return json({ consultations, freeQuota, freeSessionsUsed: usedThisMonth });
}
