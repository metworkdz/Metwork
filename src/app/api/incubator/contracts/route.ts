/**
 * GET  /api/incubator/contracts  — list the calling incubator's templates
 * POST /api/incubator/contracts  — create a template
 *
 * Incubator-guarded (ADMIN may act as the admin-incubator). Templates are
 * owned by `incubatorId`; only space contracts are in scope.
 */
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { db, type ContractTemplateRecord } from '@/server/db/store';
import { resolveContractIncubator } from '@/server/contracts/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const categorySchema = z.enum(['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM', 'DOMICILIATION', 'ANY']);

const createSchema = z.object({
  name:          z.string().min(1).max(120),
  spaceCategory: categorySchema.optional(),
  body:          z.string().min(1).max(20000),
  language:      z.enum(['fr', 'en', 'ar']),
});

export async function GET() {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await resolveContractIncubator(guard.user);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const data = await db.read();
  const items = (data.contractTemplates ?? [])
    .filter((c) => c.incubatorId === inc.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return json({ items, total: items.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await resolveContractIncubator(guard.user);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let input: z.infer<typeof createSchema>;
  try {
    input = createSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    return jsonError(400, 'INVALID_BODY', 'Invalid request body');
  }

  const now = new Date().toISOString();
  const record: ContractTemplateRecord = {
    id:            randomUUID(),
    incubatorId:   inc.id,
    name:          input.name.trim(),
    spaceCategory: input.spaceCategory ?? 'ANY',
    body:          input.body,
    language:      input.language,
    createdAt:     now,
    updatedAt:     now,
  };

  await db.update((d) => {
    if (!Array.isArray(d.contractTemplates)) d.contractTemplates = [];
    d.contractTemplates.push(record);
  });

  return json({ template: record }, { status: 201 });
}
