/**
 * PUT /api/metworkcrm/contacts/:id/organizations
 *
 * Replaces the FULL organization-link set for one contact in a single call
 * (simpler client than incremental link/unlink endpoints — the linking editor
 * always submits the whole desired set).
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { contactOrganizationsReplaceSchema } from '@/server/metworkcrm/validation/contacts';
import { getContactDetail, replaceContactOrganizations } from '@/server/metworkcrm/services/contacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = contactOrganizationsReplaceSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await replaceContactOrganizations(id, parsed.data.organizations);
    return json(await getContactDetail(id, guard.user));
  } catch (err) {
    return crmErrorResponse(err);
  }
}
