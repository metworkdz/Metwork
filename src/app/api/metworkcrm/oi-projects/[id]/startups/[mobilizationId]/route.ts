/**
 * PATCH  /api/metworkcrm/oi-projects/:id/startups/:mobilizationId — update role/status
 * DELETE /api/metworkcrm/oi-projects/:id/startups/:mobilizationId — remove the mobilization
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { oiParticipantUpdateSchema } from '@/server/metworkcrm/validation/oi-projects';
import { removeOiStartup, updateOiStartup } from '@/server/metworkcrm/services/oi-projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string; mobilizationId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { mobilizationId } = await params;

  const body = await safeJson(req);
  const parsed = oiParticipantUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await updateOiStartup(mobilizationId, parsed.data);
    return json({ ok: true });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { mobilizationId } = await params;

  try {
    await removeOiStartup(mobilizationId);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
