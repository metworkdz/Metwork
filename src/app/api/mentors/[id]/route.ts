/**
 * GET    /api/mentors/:id  — public; single mentor by id.
 * PUT    /api/mentors/:id  — admin-only; partial update.
 * DELETE /api/mentors/:id  — admin-only.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { updateMentorSchema } from '@/server/mentors/schemas';
import {
  deleteMentor,
  findMentorById,
  updateMentor,
} from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { fromZod, json, jsonError, noContent } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const mentor = await findMentorById(id);
  if (!mentor) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  return json(toMentorDto(mentor));
}

export async function PUT(
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

  let patch;
  try {
    patch = updateMentorSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const result = await updateMentor(id, patch);
  if (!result.ok) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  return json(toMentorDto(result.mentor));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const result = await deleteMentor(id);
  if (!result.ok) return jsonError(404, 'MENTOR_NOT_FOUND', 'Mentor not found');
  return noContent();
}
