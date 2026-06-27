/**
 * POST /api/admin/payouts/bank-account — register/update a payable target's
 * payout bank account (RIB) and register the SlickPay beneficiary. Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { registerPayoutContact } from '@/server/payouts/service';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  targetType: z.enum(['user', 'mentor']),
  targetId: z.string().min(1),
  title: z.string().min(1).max(120),
  firstname: z.string().min(1).max(120),
  lastname: z.string().min(1).max(120),
  address: z.string().min(1).max(240),
  rib: z.string().min(16).max(40),
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

  const result = await registerPayoutContact({
    targetType: input.targetType,
    targetId: input.targetId,
    bankAccount: {
      title: input.title,
      firstname: input.firstname,
      lastname: input.lastname,
      address: input.address,
      rib: input.rib,
    },
  });

  if (!result.ok) {
    if (result.reason === 'INVALID_RIB') return jsonError(422, 'INVALID_RIB', 'The RIB must be a valid 20-digit Algerian account number.');
    if (result.reason === 'TARGET_NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Payable target not found');
    return jsonError(502, 'SLICKPAY_ERROR', result.message ?? 'SlickPay rejected the beneficiary registration.');
  }

  void appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'PAYOUT_BANK_ACCOUNT_SET',
    targetType: input.targetType === 'user' ? 'user' : 'mentor',
    targetId: input.targetId,
    details: { ribMasked: result.bankAccount.ribMasked, slickpayRegistered: result.slickpayRegistered },
  });

  return json({ bankAccount: result.bankAccount, slickpayRegistered: result.slickpayRegistered });
}
