/** POST /api/tax/tasks/[key] — `{ done: boolean }`: mark a task done or reopen it. */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole } from '@/server/auth/api-guards';
import { fromZod, json, jsonError } from '@/server/http/json';
import { setTaskDone } from '@/server/taxes/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ key: string }> }

const bodySchema = z.object({ done: z.boolean() }).strict();

export async function POST(req: NextRequest, { params }: Ctx) {
  const guard = await requireApiRole(['FREELANCER', 'ENTREPRENEUR']);
  if (!guard.ok) return guard.response;
  const { key } = await params;
  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }
  let input;
  try { input = bodySchema.parse(body); } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }
  const result = await setTaskDone(guard.user.id, decodeURIComponent(key), input.done);
  if (result.ok) return json({ key: result.state.key, doneAt: result.state.doneAt });
  if (result.reason === 'NO_PROFILE') return jsonError(409, 'NO_TAX_PROFILE', 'Set your legal status first');
  return jsonError(404, 'NOT_FOUND', 'Task not found');
}
