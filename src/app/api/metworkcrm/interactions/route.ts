/**
 * GET  /api/metworkcrm/interactions — list, filterable by contactId/organizationId/type/nextActionDue
 * POST /api/metworkcrm/interactions — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { interactionInputSchema, interactionListQuerySchema } from '@/server/metworkcrm/validation/interactions';
import { createInteraction, listInteractions } from '@/server/metworkcrm/services/interactions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = interactionListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listInteractions(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = interactionInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const interaction = await createInteraction(parsed.data, guard.user.id);
    return json(interaction, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
