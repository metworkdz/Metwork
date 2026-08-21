/**
 * GET  /api/metworkcrm/startups — list with filters (pipelineStage, sector, organizationId, q)
 * POST /api/metworkcrm/startups — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { startupInputSchema, startupListQuerySchema } from '@/server/metworkcrm/validation/startups';
import { createStartup, listStartups } from '@/server/metworkcrm/services/startups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = startupListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listStartups(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = startupInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const startup = await createStartup(parsed.data, guard.user.id);
    return json(startup, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
