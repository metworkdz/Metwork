/**
 * GET  /api/mentors  — public; lists all mentors (used by the landing carousel).
 * POST /api/mentors  — admin-only; creates a mentor.
 */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { createMentorSchema } from '@/server/mentors/schemas';
import { createMentor, listMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { fromZod, json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const mentors = await listMentors();
  return json({
    items: mentors.map(toMentorDto),
    total: mentors.length,
  });
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
    input = createMentorSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const mentor = await createMentor(input);
  return json(toMentorDto(mentor), { status: 201 });
}
