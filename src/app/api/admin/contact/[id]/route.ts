/**
 * PATCH /api/admin/contact/[id]
 * Mark a contact submission as handled / unhandled. Admin only.
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  handled: z.boolean(),
});

interface RouteParams { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try { body = await req.json(); } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try { input = schema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await db.update((store) => {
    const sub = store.contactSubmissions.find((s) => s.id === id);
    if (!sub) return null;
    sub.handled = input.handled;
    return { ...sub };
  });

  if (!updated) return jsonError(404, 'NOT_FOUND', 'Submission not found');
  return json({ submission: updated });
}
