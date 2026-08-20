/**
 * GET  /api/metworkcrm/tasks — list, filterable by status/priority/assignee/contact/organization/q
 * POST /api/metworkcrm/tasks — create
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { taskInputSchema, taskListQuerySchema } from '@/server/metworkcrm/validation/tasks';
import { createTask, listTasks } from '@/server/metworkcrm/services/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = taskListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listTasks(parsed.data);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = taskInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const task = await createTask(parsed.data, guard.user.id);
    return json(task, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
