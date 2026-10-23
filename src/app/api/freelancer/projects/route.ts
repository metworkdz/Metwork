/** GET/POST /api/freelancer/projects — the freelancer's project board. */
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { db } from '@/server/db/store';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { createProject, listProjects } from '@/server/freelancers/workspace';
import { projectSchema } from '@/server/freelancers/workspace-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Plenty for a board; stops a script from filling the shared document. */
const MAX_PROJECTS = 500;

export async function GET() {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  return json({ items: listProjects(await db.read(), guard.user.id) });
}

export async function POST(req: NextRequest) {
  const guard = await requireApiRole(['FREELANCER']);
  if (!guard.ok) return guard.response;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = projectSchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  if (listProjects(await db.read(), guard.user.id).length >= MAX_PROJECTS) {
    return jsonError(422, 'TOO_MANY_PROJECTS', 'Archive some projects first');
  }
  return json(await createProject(guard.user.id, input), { status: 201 });
}
