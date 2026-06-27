/**
 * POST /api/admin/payouts/send — send a SlickPay transfer to a payable target.
 * Admin only. Works for a direct transfer (Users tab) or by processing an
 * existing withdrawal request (Requests tab). Idempotent on `idempotencyKey`.
 * The wallet is settled only once SlickPay confirms "sent".
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { sendTransfer } from '@/server/payouts/service';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  targetType: z.enum(['user', 'mentor']),
  targetId: z.string().min(1),
  amount: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(100),
  withdrawalRequestId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await sendTransfer({
    targetType: input.targetType,
    targetId: input.targetId,
    amount: input.amount,
    idempotencyKey: input.idempotencyKey,
    adminId: guard.user.id,
    withdrawalRequestId: input.withdrawalRequestId ?? null,
  });

  if (!result.ok) {
    switch (result.reason) {
      case 'BELOW_MINIMUM':     return jsonError(422, 'BELOW_MINIMUM', 'Minimum payout is 500 DZD.');
      case 'NO_BANK_ACCOUNT':   return jsonError(422, 'NO_BANK_ACCOUNT', 'This recipient has no bank account on file.');
      case 'TARGET_NOT_FOUND':  return jsonError(404, 'NOT_FOUND', 'Recipient not found');
      case 'REQUEST_NOT_FOUND': return jsonError(404, 'NOT_FOUND', 'Withdrawal request not found');
      case 'NOT_PENDING':       return jsonError(409, 'ALREADY_RESOLVED', 'That withdrawal request is already resolved.');
      case 'ALREADY_PROCESSING':return jsonError(409, 'ALREADY_PROCESSING', 'A payout is already in progress for this recipient.');
      case 'WALLET_FROZEN':     return jsonError(409, 'WALLET_FROZEN', 'The recipient wallet is frozen.');
      case 'INSUFFICIENT_FUNDS':return jsonError(422, 'INSUFFICIENT_FUNDS', 'Amount exceeds the recipient balance.', { balance: result.balance });
      case 'INVALID_RIB':       return jsonError(422, 'INVALID_RIB', 'The bank account RIB is invalid.');
      case 'DISPATCH_FAILED':   return jsonError(502, 'DISPATCH_FAILED', result.message ?? 'SlickPay rejected the payout. It can be retried.');
    }
  }

  void appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'PAYOUT_SENT',
    targetType: input.targetType === 'user' ? 'user' : 'mentor',
    targetId: input.targetId,
    details: { amount: input.amount, finalStatus: result.finalStatus, requestId: result.requestId, replayed: result.replayed },
  });

  return json({
    finalStatus: result.finalStatus,
    redirectUrl: result.redirectUrl,
    requestId: result.requestId,
    replayed: result.replayed,
  });
}
