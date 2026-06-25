/**
 * PATCH  /api/incubator/contracts/[id]  — update a template (owner only)
 * DELETE /api/incubator/contracts/[id]  — delete a template (owner only)
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type ContractTemplateRecord } from '@/server/db/store';
import { resolveContractIncubator } from '@/server/contracts/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION', 'ANY']);

const updateSchema = z.object({
  name:          z.string().min(1).max(120).optional(),
  spaceCategory: categorySchema.optional(),
  body:          z.string().min(1).max(20000).optional(),
  language:      z.enum(['fr', 'en', 'ar']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await resolveContractIncubator(guard.user);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;

  let input: z.infer<typeof updateSchema>;
  try {
    input = updateSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_BODY', 'Invalid request body');
  }

  const updated = await db.update((d) => {
    const rec = (d.contractTemplates ?? []).find((c) => c.id === id && c.incubatorId === inc.id);
    if (!rec) return null;
    if (input.name !== undefined)          rec.name = input.name.trim();
    if (input.spaceCategory !== undefined) rec.spaceCategory = input.spaceCategory;
    if (input.body !== undefined)          rec.body = input.body;
    if (input.language !== undefined)      rec.language = input.language;
    rec.updatedAt = new Date().toISOString();
    return rec as ContractTemplateRecord;
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Template not found');
  return json({ template: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await resolveContractIncubator(guard.user);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { id } = await params;

  const removed = await db.update((d) => {
    const list = d.contractTemplates ?? [];
    const idx = list.findIndex((c) => c.id === id && c.incubatorId === inc.id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  });

  if (!removed) return jsonError(404, 'NOT_FOUND', 'Template not found');
  return json({ ok: true });
}
