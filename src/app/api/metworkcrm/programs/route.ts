/**
 * GET  /api/metworkcrm/programs — list with filters (type, stage, q)
 * POST /api/metworkcrm/programs — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { programInputSchema, programListQuerySchema } from '@/server/metworkcrm/validation/programs';
import { createProgram, listPrograms } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = programListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listPrograms(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = programInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const program = await createProgram(parsed.data, guard.user.id);
    return json(program, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
