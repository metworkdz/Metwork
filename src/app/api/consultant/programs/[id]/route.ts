/**
 * PATCH  /api/consultant/programs/[id] — update a consultant-owned program
 * DELETE /api/consultant/programs/[id] — delete one
 *
 * Authorization goes through the SAME canonical gate the incubator routes use
 * (`canEditProgram` / `canDeleteProgram`), with a MENTOR actor instead of a
 * USER one — so a consultant can only ever touch their own rows, and can never
 * reach an incubator-owned program.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import { canDeleteProgram, canEditProgram, type ProgramActor } from '@/server/programs/ownership';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isoDate = z
  .string()
  .refine(
    (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isNaN(Date.parse(s)),
    'Must be a valid date (YYYY-MM-DD or ISO 8601)',
  );

const patchSchema = z.object({
  title: z.string().min(2).max(150).optional(),
  description: z.string().max(2000).optional(),
  type: z.enum(['INCUBATION', 'ACCELERATION', 'TRAINING', 'BOOTCAMP', 'WORKSHOP', 'WEBINAR']).optional(),
  city: z.string().min(1).optional(),
  imageUrl: z.string().url().nullable().optional(),
  imageUrls: z.array(z.string().url()).max(8).optional(),
  seatsTotal: z.number().int().positive().optional(),
  deadline:  isoDate.optional(),
  startDate: isoDate.optional(),
  endDate:   isoDate.optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).optional(),
  slug: z.string().regex(/^[a-z0-9-]+$/).min(2).max(120).optional().nullable(),
}).refine(
  (d) => {
    if (d.startDate && d.endDate && d.startDate >= d.endDate) return false;
    if (d.deadline && d.startDate && d.deadline > d.startDate) return false;
    return true;
  },
  { message: 'deadline must be ≤ startDate, and startDate must be < endDate' },
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = patchSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const actor: ProgramActor = { kind: 'MENTOR', mentorId: guard.mentorId };

  const program = await db.update((d) => {
    const p = (d.programs ?? []).find((x) => x.id === id);
    if (!p) return null;
    if (canEditProgram(p, actor, d.incubators) !== 'ALLOW') return 'FORBIDDEN';

    if (input.title !== undefined) p.title = input.title;
    if (input.description !== undefined) p.description = input.description;
    if (input.type !== undefined) p.type = input.type;
    if (input.city !== undefined) p.city = input.city;
    if (input.imageUrl !== undefined) p.imageUrl = input.imageUrl ?? null;
    if (input.imageUrls !== undefined) {
      p.imageUrls = input.imageUrls;
      p.imageUrl = input.imageUrls[0] ?? null;
    }
    if (input.seatsTotal !== undefined) p.seatsTotal = input.seatsTotal;
    if (input.deadline !== undefined) p.deadline = input.deadline;
    if (input.startDate !== undefined) p.startDate = input.startDate;
    if (input.endDate !== undefined) p.endDate = input.endDate;
    if (input.status !== undefined) p.isActive = input.status === 'PUBLISHED';
    if (input.slug !== undefined) p.slug = input.slug ?? undefined;
    p.updatedAt = new Date().toISOString();
    return p;
  });

  if (program === null) return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (program === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ program });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const actor: ProgramActor = { kind: 'MENTOR', mentorId: guard.mentorId };

  const result = await db.update((d) => {
    const programs = d.programs ?? [];
    const idx = programs.findIndex((x) => x.id === id);
    if (idx === -1) return 'NOT_FOUND';
    const decision = canDeleteProgram(programs[idx], actor, d.incubators);
    if (decision !== 'ALLOW') return decision;
    programs.splice(idx, 1);
    return 'OK';
  });

  if (result === 'NOT_FOUND') return jsonError(404, 'NOT_FOUND', 'Program not found');
  if (result === 'FORBIDDEN') return jsonError(403, 'FORBIDDEN', 'Not your program');
  return json({ ok: true });
}
