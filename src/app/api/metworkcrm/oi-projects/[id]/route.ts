/**
 * GET    /api/metworkcrm/oi-projects/:id — detail (org/contact/partnership, mobilized startups/experts, tasks, documents)
 * PATCH  /api/metworkcrm/oi-projects/:id — partial update (stage change bumps stageChangedAt)
 * DELETE /api/metworkcrm/oi-projects/:id — hard delete, guarded (see delete-guard.ts)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { oiProjectUpdateSchema } from '@/server/metworkcrm/validation/oi-projects';
import { deleteOiProject, getOiProjectDetail, updateOiProject } from '@/server/metworkcrm/services/oi-projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    return json(await getOiProjectDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = oiProjectUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updateOiProject(id, parsed.data));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteOiProject(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
