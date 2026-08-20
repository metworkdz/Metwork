/**
 * PATCH  /api/metworkcrm/tasks/:id — partial update (status/priority/assignee/links/etc.)
 * DELETE /api/metworkcrm/tasks/:id
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { taskUpdateSchema } from '@/server/metworkcrm/validation/tasks';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { deleteTask, updateTask } from '@/server/metworkcrm/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = taskUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const patch = pickProvidedFields(body, parsed.data);
    return json(await updateTask(id, patch));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteTask(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
