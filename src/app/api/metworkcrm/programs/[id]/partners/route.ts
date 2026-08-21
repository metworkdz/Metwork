/** POST /api/metworkcrm/programs/:id/partners — link a Partnership or Organization {partnershipId?, organizationId?, role?} */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { partnerInputSchema } from '@/server/metworkcrm/validation/programs';
import { addPartner } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = partnerInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await addPartner(id, parsed.data);
    return json({ ok: true }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
