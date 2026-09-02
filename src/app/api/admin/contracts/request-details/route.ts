/**
 * POST /api/admin/contracts/request-details  { consultantId }
 *
 * Ask a consultant to fill in the identity fields their contract needs.
 *
 * Exists because `createDraftContract` REFUSES when the legal address or ID
 * number is missing — correctly, since tokens are merged once and frozen, so a
 * contract drafted against an empty profile is permanently wrong. That left the
 * admin able to see the block but with no way to act on it. This is the action.
 *
 * Deliberately narrow: it sends a prompt and nothing else. It cannot issue a
 * contract, cannot edit the consultant, and reveals no contract terms — the
 * mailbox is not an authenticated channel.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';
import { missingConsultantIdentity } from '@/server/consultant-contracts/service';
import { sendContractDetailsRequestEmail } from '@/server/notifications/mock';
import { checkRateLimitDistributed } from '@/lib/rate-limit';
import { clientEnvVars } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ consultantId: z.string().min(1) });

/** French labels for the fields the contract needs. */
const LABELS: Record<'address' | 'idNumber', string> = {
  address: 'Votre adresse complète',
  idNumber: "Votre numéro de pièce d'identité",
};

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = schema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const data = await db.read();
  const mentor = (data.mentors ?? []).find((m) => m.id === input.consultantId);
  if (!mentor) return jsonError(404, 'CONSULTANT_NOT_FOUND', 'Consultant not found');
  if (!mentor.email) {
    return jsonError(422, 'NO_EMAIL', 'This consultant has no email address on file.');
  }

  // Read the gap from the SAME function contract creation refuses on, so the
  // mail can never ask for something that is already filled in.
  const missing = missingConsultantIdentity(mentor);
  if (missing.length === 0) {
    return jsonError(409, 'ALREADY_COMPLETE', 'This consultant has already completed their details.');
  }

  // One nudge per consultant per hour. A "remind them" button is easy to click
  // twice, and the consultant should not be mailed repeatedly for one gap.
  if (!(await checkRateLimitDistributed(`contract-details:${mentor.id}`, 1, 60 * 60_000))) {
    return jsonError(429, 'RATE_LIMITED', 'A reminder was already sent to this consultant in the last hour.');
  }

  const base = clientEnvVars.NEXT_PUBLIC_APP_URL.replace(/\/$/, '');
  // AWAITED — an unawaited send is dropped when the lambda freezes. Self-catching,
  // so a mail failure cannot fail the admin's request.
  await sendContractDetailsRequestEmail(mentor.email, {
    consultantName: mentor.fullName,
    portalUrl: `${base}/mentordashboard`,
    missingLabels: missing.map((f) => LABELS[f]),
  });

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'CONTRACT_DETAILS_REQUESTED',
    targetType: 'mentor',
    targetId: mentor.id,
    details: { missing },
  });

  return json({ ok: true, sentTo: mentor.email });
}
