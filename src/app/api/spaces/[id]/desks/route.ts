/**
 * GET /api/spaces/:id/desks?date=YYYY-MM-DD — public desk availability.
 *
 * Returns the desks bookable on a single day for a COWORKING space, computed by
 * the canonical `getAvailableDesks` (taken desks are simply absent — never shown
 * as greyed-out). Read-only; `force-dynamic` so a fresh booking reflects at once.
 *
 * Visibility mirrors the public catalog: only active spaces of publicly-visible
 * incubators resolve (via `findSpaceById`), so this never leaks a hidden listing.
 */
import type { NextRequest } from 'next/server';
import { findSpaceById } from '@/server/bookings/space-catalog';
import { getAvailableDesks } from '@/server/spaces/availability';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const space = await findSpaceById(id);
  if (!space) return jsonError(404, 'NOT_FOUND', 'Space not found');

  const url = new URL(req.url);
  const date = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!ISO_DATE.test(date)) {
    return jsonError(400, 'INVALID_DATE', '`date` must be YYYY-MM-DD');
  }

  // Canonical availability — never inline the desk-overlap rules here.
  const available = await getAvailableDesks(id, date);

  return json({ spaceId: id, date, available });
}
