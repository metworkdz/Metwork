/**
 * GET  /api/academy/enrollments/{id}/refund — can this purchase still be refunded?
 * POST /api/academy/enrollments/{id}/refund — refund it to the Metwork wallet.
 * Rule: within 7 days, under 25 % watched, no certificate.
 */
import type { NextRequest } from 'next/server';
import { json, jsonError } from '@/server/http/json';
import { refundCheck, refundEnrollment } from '@/server/academy/orders';
import { requireAcademyLearner } from '@/server/academy/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { id } = await params;
  return json(await refundCheck(g.user.id, id));
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const g = await requireAcademyLearner();
  if (!g.ok) return g.response;
  const { id } = await params;
  const res = await refundEnrollment(g.user.id, id);
  if (!res.ok) return jsonError(res.reason === 'NOT_FOUND' ? 404 : 409, res.reason, res.reason);
  return json(res);
}
