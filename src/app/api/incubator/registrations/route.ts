/**
 * GET  /api/incubator/registrations?entityType=&entityId=&page=&pageSize=&q=&status=
 *   — list registrations for a program or event
 * DELETE /api/incubator/registrations/:id (via body { id })
 *   — cancel a registration
 */
import type { NextRequest } from 'next/server';
import { z, ZodError } from 'zod';
import { requireApiRole, requireApprovedApiRole } from '@/server/auth/api-guards';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { listRegistrations, cancelRegistration, incubatorScope } from '@/server/registrations/service';
import { fromZod, json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType') as 'PROGRAM' | 'EVENT' | null;
  const entityId   = searchParams.get('entityId');
  const page       = Math.max(1, Number(searchParams.get('page') ?? '1'));
  const pageSize   = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') ?? '20')));
  const q          = (searchParams.get('q') ?? '').trim().toLowerCase();
  const statusFilter = searchParams.get('status');

  if (!entityType || !['PROGRAM', 'EVENT'].includes(entityType)) {
    return jsonError(400, 'MISSING_PARAM', 'entityType must be PROGRAM or EVENT');
  }
  if (!entityId) {
    return jsonError(400, 'MISSING_PARAM', 'entityId is required');
  }

  let registrations = await listRegistrations(entityType, entityId, incubatorScope(inc.id));

  // Attach field definitions so the client can render the answers
  const data = await db.read();
  const formFields = (data.registrationFormFields ?? [])
    .filter((f) => f.entityType === entityType && f.entityId === entityId)
    .sort((a, b) => a.order - b.order);

  // Search filter
  if (q) {
    registrations = registrations.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        r.phone.includes(q),
    );
  }

  // Status filter
  if (statusFilter && ['CONFIRMED', 'WAITLISTED', 'CANCELLED'].includes(statusFilter)) {
    registrations = registrations.filter((r) => r.status === statusFilter);
  }

  const total = registrations.length;
  const items = registrations.slice((page - 1) * pageSize, page * pageSize);

  return json({
    items,
    formFields,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  });
}

const cancelSchema = z.object({
  id: z.string().uuid(),
});

export async function DELETE(req: NextRequest) {
  const guard = await requireApprovedApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const inc = await findIncubatorByUserEmail(guard.user.email);
  if (!inc) return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile linked to this account');

  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonError(400, 'INVALID_JSON', 'Request body must be JSON'); }

  let input;
  try { input = cancelSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    throw err;
  }

  const updated = await cancelRegistration(input.id, incubatorScope(inc.id));
  if (!updated) return jsonError(404, 'NOT_FOUND', 'Registration not found');

  return json({ registration: updated });
}
