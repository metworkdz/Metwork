/**
 * Registration form builder for CONSULTANT-owned programs.
 *
 *   GET    /api/consultant/registration-form?entityId=  — list fields
 *   POST   /api/consultant/registration-form            — bulk-replace fields
 *   DELETE /api/consultant/registration-form?id=        — delete one field
 *
 * Thin ownership wrapper over the SAME `@/server/registrations/service` the
 * incubator route uses — the field model, validation and answer-pruning are
 * shared, only the owner scope differs. `entityType` is fixed to PROGRAM:
 * events are incubator-only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireConsultant } from '@/server/mentors/access';
import {
  listFormFields,
  replaceFormFields,
  deleteFormField,
  mentorScope,
} from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELD_TYPES = [
  'SHORT_TEXT', 'LONG_TEXT', 'DROPDOWN', 'MULTIPLE_CHOICE',
  'CHECKBOX', 'PHONE', 'EMAIL', 'URL',
] as const;

const fieldSchema = z.object({
  label:    z.string().min(1).max(200).transform((s) => s.trim()),
  type:     z.enum(FIELD_TYPES),
  options:  z.array(z.string().min(1).max(200)).nullable().optional().transform((v) => v ?? null),
  required: z.boolean().default(false),
  order:    z.number().int().min(0).default(0),
});

const replaceSchema = z.object({
  entityId: z.string().uuid(),
  fields:   z.array(fieldSchema).max(30),
});

/** Does this consultant own the program? */
async function ownsProgram(mentorId: string, programId: string): Promise<boolean> {
  const data = await db.read();
  return (data.programs ?? []).some((p) => p.id === programId && p.mentorId === mentorId);
}

export async function GET(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const entityId = new URL(req.url).searchParams.get('entityId');
  if (!entityId) return jsonError(400, 'MISSING_PARAM', 'entityId is required');
  if (!(await ownsProgram(guard.mentorId, entityId))) {
    return jsonError(403, 'FORBIDDEN', 'This program does not belong to you');
  }

  return json({ fields: await listFormFields('PROGRAM', entityId) });
}

export async function POST(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = replaceSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  if (!(await ownsProgram(guard.mentorId, input.entityId))) {
    return jsonError(403, 'FORBIDDEN', 'This program does not belong to you');
  }

  for (const f of input.fields) {
    if (['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'].includes(f.type)) {
      if (!f.options || f.options.length < 1) {
        return jsonError(422, 'OPTIONS_REQUIRED', `Field "${f.label}" of type ${f.type} requires at least one option`);
      }
    }
  }

  const fields = await replaceFormFields(
    'PROGRAM',
    input.entityId,
    mentorScope(guard.mentorId),
    input.fields.map((f, i) => ({
      label:    f.label,
      type:     f.type,
      options:  f.options ?? null,
      required: f.required,
      order:    i,
    })),
  );

  return json({ fields });
}

export async function DELETE(req: NextRequest) {
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const fieldId = new URL(req.url).searchParams.get('id');
  if (!fieldId) return jsonError(400, 'MISSING_PARAM', 'id query parameter is required');

  // Scoped delete — a field belonging to anyone else simply isn't found.
  const deleted = await deleteFormField(fieldId, mentorScope(guard.mentorId));
  if (!deleted) return jsonError(404, 'NOT_FOUND', 'Field not found');

  return json({ ok: true });
}
