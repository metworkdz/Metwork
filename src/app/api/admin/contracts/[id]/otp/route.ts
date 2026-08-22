/**
 * POST /api/admin/contracts/:id/otp — resend the signing code on the
 * consultant's behalf (the "I never got it" support path).
 *
 * Reuses the SAME throttle and lockout as the consultant's own resend — the
 * policy lives in `consultant-contracts/service.ts`, so an admin cannot be used
 * as a way around the cap. That matters: the code authorises a signature, and
 * an unbounded admin-triggered resend would be a way to spray codes at a
 * consultant's phone.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { sendSigningOtp } from '@/server/consultant-contracts/service';
import { sendOtpSms, sendOtpWhatsApp } from '@/server/notifications/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ channel: z.enum(['whatsapp', 'sms']).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;

  let channel: 'whatsapp' | 'sms' = 'whatsapp';
  try {
    channel = schema.parse(await req.json()).channel ?? 'whatsapp';
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    // No/empty body — keep the default channel.
  }

  // Attributed to the admin, so the contract's own trail shows a resend the
  // consultant did not request.
  const result = await sendSigningOtp(id, guard.user.id);
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Contract not found');
    if (result.reason !== 'THROTTLED') {
      return jsonError(409, 'NOT_PENDING', 'This contract is not awaiting signature.');
    }
    return jsonError(
      429,
      result.detail.reason === 'LOCKED' ? 'OTP_LOCKED' : 'OTP_THROTTLED',
      'The resend limit for this contract has been reached. Wait before sending another code.',
      { retryAfterSeconds: Math.ceil(result.detail.retryAfterMs / 1000) },
    );
  }

  try {
    if (channel === 'sms') await sendOtpSms(result.phone, result.code);
    else await sendOtpWhatsApp(result.phone, result.code);
  } catch (err) {
    console.error('[admin/contracts/otp] delivery failed:', err);
    return jsonError(502, 'DELIVERY_FAILED', 'Could not send the code. Try the other channel.');
  }

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_OTP_RESENT',
    targetType: 'consultant_contract',
    targetId: id,
    details: { channel },
  });

  return json({ ok: true, channel, expiresAt: result.expiresAt });
}
