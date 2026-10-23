/**
 * GET  /api/cofounder/matches/[id]/agreement — the match's live agreement (or null).
 * POST /api/cofounder/matches/[id]/agreement — start a draft.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { json, jsonError } from '@/server/http/json';
import { agreementFor, agreementView, createAgreement, finalize } from '@/server/cofounder/agreement';
import { agreementErrorResponse } from '@/server/cofounder/agreement-http';
import { withCofounder } from '@/server/cofounder/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return withCofounder(async () => {
    let a = await agreementFor(guard.user.id, id);
    if (a === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Match not found');
    // Both signed but the PDF step failed earlier: finish it now.
    if (a && a.status === 'PENDING_SIGNATURES' && Object.keys(a.signatures).length === 2) {
      const done = await finalize(a.id);
      if (done.ok) a = done.value;
    }
    return json({ agreement: a ? agreementView(a, guard.user.id) : null });
  });
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['ENTREPRENEUR', 'FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return withCofounder(async () => {
    const r = await createAgreement(guard.user.id, id);
    return r.ok ? json({ agreement: agreementView(r.value, guard.user.id) }, { status: 201 }) : agreementErrorResponse(r.reason);
  });
}
