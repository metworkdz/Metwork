/**
 * PATCH  /api/metworkcrm/programs/:id/participants/:participantId — update status/attendance/etc.
 * DELETE /api/metworkcrm/programs/:id/participants/:participantId — remove the registration
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { participantUpdateSchema } from '@/server/metworkcrm/validation/programs';
import { pickProvidedFields } from '@/server/metworkcrm/validation/patch-utils';
import { removeParticipant, updateParticipant } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string; participantId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { participantId } = await params;

  const body = await safeJson(req);
  const parsed = participantUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await updateParticipant(participantId, pickProvidedFields(body, parsed.data));
    return json({ ok: true });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { participantId } = await params;

  try {
    await removeParticipant(participantId);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
