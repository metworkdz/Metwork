/** DELETE /api/metworkcrm/programs/:id/partners/:partnerId — unlink the partner */
import type { NextRequest } from 'next/server';
import { noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse } from '@/server/metworkcrm/http';
import { removePartner } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string; partnerId: string }>;
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { partnerId } = await params;

  try {
    await removePartner(partnerId);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
