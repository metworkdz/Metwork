/**
 * GET    /api/metworkcrm/contacts/:id — detail + every linked Organization/Interaction/Task/Opportunity
 * PATCH  /api/metworkcrm/contacts/:id — partial update (may include a full `organizations` replacement)
 * DELETE /api/metworkcrm/contacts/:id — hard delete, guarded
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { contactUpdateSchema } from '@/server/metworkcrm/validation/contacts';
import { deleteContact, getContactDetail, updateContact } from '@/server/metworkcrm/services/contacts';

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
    return json(await getContactDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = contactUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    return json(await updateContact(id, parsed.data, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  try {
    await deleteContact(id);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
