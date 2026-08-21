/**
 * POST /api/metworkcrm/programs/:id/payments — ADMIN-only.
 * Dev rules: Payments is an admin-only module — this mini "add payment" form
 * embedded in Program detail follows the same gate as the standalone module,
 * not just money redaction on read.
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiAdmin } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { programPaymentInputSchema } from '@/server/metworkcrm/validation/programs';
import { createProgramPayment } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = programPaymentInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const payment = await createProgramPayment(id, parsed.data, guard.user.id);
    return json(payment, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
