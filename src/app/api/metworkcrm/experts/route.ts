/**
 * GET  /api/metworkcrm/experts — list with filters (pipelineStage, q)
 * POST /api/metworkcrm/experts — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { expertInputSchema, expertListQuerySchema } from '@/server/metworkcrm/validation/experts';
import { createExpert, listExperts } from '@/server/metworkcrm/services/experts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = expertListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listExperts(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = expertInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const expert = await createExpert(parsed.data, guard.user.id);
    return json(expert, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
