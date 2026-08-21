/**
 * GET  /api/metworkcrm/space-bookings — list with filters (spaceType, status, organizationId, q)
 * POST /api/metworkcrm/space-bookings — create (reference auto-generated)
 */
import type { NextRequest } from 'next/server';
import { json, fromZod } from '@/server/http/json';
import { requireCrmApiUser } from '@/server/metworkcrm/auth/guards';
import { crmErrorResponse, safeJson } from '@/server/metworkcrm/http';
import { spaceBookingInputSchema, spaceBookingListQuerySchema } from '@/server/metworkcrm/validation/space-bookings';
import { createSpaceBooking, listSpaceBookings } from '@/server/metworkcrm/services/space-bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const parsed = spaceBookingListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return fromZod(parsed.error);

  const { rows, total } = await listSpaceBookings(parsed.data, guard.user);
  return json({ rows, total, limit: parsed.data.limit, offset: parsed.data.offset });
}

export async function POST(req: NextRequest) {
  const guard = await requireCrmApiUser();
  if (!guard.ok) return guard.response;

  const body = await safeJson(req);
  const parsed = spaceBookingInputSchema.safeParse(body);
  if (!parsed.success) return fromZod(parsed.error);

  try {
    const booking = await createSpaceBooking(parsed.data, guard.user.id);
    return json(booking, { status: 201 });
  } catch (err) {
    return crmErrorResponse(err);
  }
}
