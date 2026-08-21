/**
 * GET    /api/metworkcrm/programs/:id — detail (participants, trainers, partners, tasks, payments)
 * PATCH  /api/metworkcrm/programs/:id — partial update (stage change bumps stageChangedAt)
 * DELETE /api/metworkcrm/programs/:id — hard delete, guarded (see delete-guard.ts)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { programUpdateSchema } from '@/server/metworkcrm/validation/programs';
import { deleteProgram, getProgramDetail, updateProgram } from '@/server/metworkcrm/services/programs';

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
    return json(await getProgramDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = programUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updateProgram(id, parsed.data));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteProgram(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
