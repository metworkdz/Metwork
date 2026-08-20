/**
 * GET  /api/metworkcrm/organizations — list with filters (type, sector, city, status, q)
 * POST /api/metworkcrm/organizations — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { organizationInputSchema, organizationListQuerySchema } from '@/server/metworkcrm/validation/organizations';
import { createOrganization, listOrganizations } from '@/server/metworkcrm/services/organizations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = organizationListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listOrganizations(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = organizationInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const org = await createOrganization(parsed.data, guard.user.id);
    return json(org, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
