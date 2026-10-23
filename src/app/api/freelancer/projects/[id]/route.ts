/** PATCH/DELETE /api/freelancer/projects/[id] — owner-scoped. */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { deleteProject, updateProject } from '@/server/freelancers/workspace';
import { projectSchema } from '@/server/freelancers/workspace-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = projectSchema.partial().parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const project = await updateProject(guard.user.id, id, input);
  return project ? json(project) : jsonError(404, 'NOT_FOUND', 'Project not found');
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  const { id } = await params;
  return (await deleteProject(guard.user.id, id)) ? json({ ok: true }) : jsonError(404, 'NOT_FOUND', 'Project not found');
}
