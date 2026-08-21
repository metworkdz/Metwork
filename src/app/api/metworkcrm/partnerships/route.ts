/**
 * GET  /api/metworkcrm/partnerships — list with filters (type, stage, organizationId, q)
 * POST /api/metworkcrm/partnerships — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { partnershipInputSchema, partnershipListQuerySchema } from '@/server/metworkcrm/validation/partnerships';
import { createPartnership, listPartnerships } from '@/server/metworkcrm/services/partnerships';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = partnershipListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listPartnerships(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = partnershipInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const partnership = await createPartnership(parsed.data, guard.user.id);
    return json(partnership, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
