/** POST /api/metworkcrm/oi-projects/:id/experts — mobilize an expert {expertId, role?, status?} */
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { oiParticipantInputSchema } from '@/server/metworkcrm/validation/oi-projects';
import { addOiExpert } from '@/server/metworkcrm/services/oi-projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = oiParticipantInputSchema.extend({ expertId: z.string().trim().min(1) });

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const body = await safeJson(req);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await addOiExpert(id, parsed.data.expertId, { role: parsed.data.role, status: parsed.data.status });
    return json({ ok: true }, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
