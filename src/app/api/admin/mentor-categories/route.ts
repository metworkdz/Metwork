/**
 * GET  /api/admin/mentor-categories  — list all mentor categories (active + inactive)
 * POST /api/admin/mentor-categories  — create a new mentor category
 *
 * Admin-only endpoint.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { listMentorCategories, createMentorCategory } from '@/server/mentor-categories/service';
import { createMentorCategorySchema } from '@/server/mentor-categories/schemas';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const categories = await listMentorCategories();
  return json({ items: categories, total: categories.length });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'INVALID_JSON', 'Request body must be JSON');
  }

  let input;
  try {
    input = createMentorCategorySchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const category = await createMentorCategory(input);
  return json(category, { status: 201 });
}
