/**
 * PATCH  /api/metworkcrm/interactions/:id — partial update (incl. marking the next action done)
 * DELETE /api/metworkcrm/interactions/:id
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { interactionUpdateSchema } from '@/server/metworkcrm/validation/interactions';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { deleteInteraction, updateInteraction } from '@/server/metworkcrm/services/interactions';

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
  const parsed = interactionUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const patch = pickProvidedFields(body, parsed.data);
    return json(await updateInteraction(id, patch));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteInteraction(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
