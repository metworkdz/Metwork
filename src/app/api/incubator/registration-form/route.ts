/**
 * GET    /api/incubator/registration-form?entityType=&entityId=
 *   — list form fields for a program/event
 * POST   /api/incubator/registration-form
 *   — bulk-replace all fields (sent as { entityType, entityId, fields[] })
 * DELETE /api/incubator/registration-form?id=
 *   — delete a single field
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import {
  listFormFields,
  replaceFormFields,
  deleteFormField,
} from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELD_TYPES = [
  'SHORT_TEXT',
  'LONG_TEXT',
  'DROPDOWN',
  'MULTIPLE_CHOICE',
  'CHECKBOX',
  'PHONE',
  'EMAIL',
  'URL',
] as const;

const fieldSchema = z.object({
  label:    z.string().min(1).max(200).transform((s) => s.trim()),
  type:     z.enum(FIELD_TYPES),
  options:  z.array(z.string().min(1).max(200)).nullable().optional().transform((v) => v ?? null),
  required: z.boolean().default(false),
  order:    z.number().int().min(0).default(0),
});

const replaceSchema = z.object({
  entityType: z.enum(['PROGRAM', 'EVENT']),
  entityId:   z.string().uuid(),
  fields:     z.array(fieldSchema).max(30),
});

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') as 'PROGRAM' | 'EVENT' | null;
  const entityId   = searchParams.get('entityId');

  if (!entityType || !['PROGRAM', 'EVENT'].includes(entityType)) {
    return jsonError(400, 'MISSING_PARAM', 'entityType must be PROGRAM or EVENT');
  }
  if (!entityId) {
    return jsonError(400, 'MISSING_PARAM', 'entityId is required');
  }

  // Verify ownership
  const data = await db.read();
  const owned =
    entityType === 'PROGRAM'
      ? (data.programs ?? []).some((p) => p.id === entityId && p.incubatorId === inc.id)
      : (data.events ?? []).some((e) => e.id === entityId && e.incubatorId === inc.id);
  if (!owned) return jsonError(403, 'FORBIDDEN', 'This entity does not belong to your incubator');

  const fields = await listFormFields(entityType, entityId);
  return json({ fields });
}

export async function POST(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = replaceSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  // Verify ownership
  const data = await db.read();
  const owned =
    input.entityType === 'PROGRAM'
      ? (data.programs ?? []).some((p) => p.id === input.entityId && p.incubatorId === inc.id)
      : (data.events ?? []).some((e) => e.id === input.entityId && e.incubatorId === inc.id);
  if (!owned) return jsonError(403, 'FORBIDDEN', 'This entity does not belong to your incubator');

  // Validate: options required for choice-type fields
  for (const f of input.fields) {
    if (['DROPDOWN', 'MULTIPLE_CHOICE', 'CHECKBOX'].includes(f.type)) {
      if (!f.options || f.options.length < 1) {
        return jsonError(422, 'OPTIONS_REQUIRED', `Field "${f.label}" of type ${f.type} requires at least one option`);
      }
    }
  }

  const fields = await replaceFormFields(
    input.entityType,
    input.entityId,
    inc.id,
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
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN', 'BUSINESS']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { searchParams } = new URL(req.url);
  const fieldId = searchParams.get('id');
  if (!fieldId) return jsonError(400, 'MISSING_PARAM', 'id query parameter is required');

  const deleted = await deleteFormField(fieldId, inc.id);
  if (!deleted) return jsonError(404, 'NOT_FOUND', 'Field not found');

  return json({ ok: true });
}
