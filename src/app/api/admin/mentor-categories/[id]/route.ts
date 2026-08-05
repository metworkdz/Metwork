/**
 * PATCH /api/admin/mentor-categories/:id  — rename, reorder, or (de)activate a category
 * DELETE is intentionally omitted — deactivate via active: false instead.
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { updateMentorCategory } from '@/server/mentor-categories/service';
import { patchMentorCategorySchema } from '@/server/mentor-categories/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = patchMentorCategorySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await updateMentorCategory(id, input);
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Mentor category not found');
  return json(updated);
}
