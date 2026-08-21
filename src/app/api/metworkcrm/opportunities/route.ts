/**
 * GET  /api/metworkcrm/opportunities — list with filters (type, stage, organizationId, ownerId, q)
 * POST /api/metworkcrm/opportunities — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { opportunityInputSchema, opportunityListQuerySchema } from '@/server/metworkcrm/validation/opportunities';
import { createOpportunity, listOpportunities } from '@/server/metworkcrm/services/opportunities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = opportunityListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listOpportunities(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = opportunityInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const opp = await createOpportunity(parsed.data, guard.user.id);
    return json(opp, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
