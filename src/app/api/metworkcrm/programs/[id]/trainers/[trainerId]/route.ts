/**
 * PATCH  /api/metworkcrm/programs/:id/trainers/:trainerId — update fee/confirmed
 * DELETE /api/metworkcrm/programs/:id/trainers/:trainerId — remove the trainer
 */
import type { NextRequest } from 'next/server';
import { json, fromZod, noContent } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { trainerUpdateSchema } from '@/server/metworkcrm/validation/programs';
import { removeTrainer, updateTrainer } from '@/server/metworkcrm/services/programs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string; trainerId: string }>;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { trainerId } = await params;

  const body = await safeJson(req);
  const parsed = trainerUpdateSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    await updateTrainer(trainerId, parsed.data);
    return json({ ok: true });
  } catch (err) {
    return crmErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;
  const { trainerId } = await params;

  try {
    await removeTrainer(trainerId);
    return noContent();
  } catch (err) {
    return crmErrorResponse(err);
  }
}
