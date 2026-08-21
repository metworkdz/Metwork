/**
 * GET  /api/metworkcrm/oi-projects — list with filters (stage, organizationId, q)
 * POST /api/metworkcrm/oi-projects — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { oiProjectInputSchema, oiProjectListQuerySchema } from '@/server/metworkcrm/validation/oi-projects';
import { createOiProject, listOiProjects } from '@/server/metworkcrm/services/oi-projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = oiProjectListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listOiProjects(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = oiProjectInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const project = await createOiProject(parsed.data, guard.user.id);
    return json(project, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
