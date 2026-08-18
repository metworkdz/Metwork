/**
 * GET /api/consultant/spaces — spaces a consultant can reserve from the portal.
 *
 * Consultants settle with the space directly on site, so this deliberately
 * lists ONLY spaces that accept CASH. A space that is online-payment-only is
 * not bookable here (the consultant has no Metwork wallet and no card rail),
 * and showing it would just produce a dead end at confirm time.
 *
 * Reuses the canonical public catalog (`listSpaces`), which already hides
 * spaces whose owning incubator is not ACTIVE / is archived — so no visibility
 * rule is re-implemented here. `businessType` is deliberately NOT filtered on:
 * it is an informational label that is null on every pre-merge incubator, so
 * filtering by it would hide most real spaces.
 */
import { json, jsonError } from '@/server/http/json';
import { db } from '@/server/db/store';
import { listSpaces } from '@/server/bookings/space-catalog';
import { requireConsultant } from '@/server/mentors/access';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isInstantBookEnabled()) return jsonError(404, 'NOT_FOUND', 'Not found');
  const guard = await requireConsultant();
  if (!guard.ok) return guard.response;

  const all = await listSpaces();
  const cashOnly = all.filter((s) => s.acceptedPaymentMethods?.includes('CASH'));

  // Attach the host's public phone so the consultant can simply call the space
  // instead of reserving — reserving here is a convenience, not a requirement.
  const data = await db.read();
  const phoneByIncubator = new Map(
    (data.incubators ?? []).map((i) => [i.id, i.contactPhone?.trim() || i.phone?.trim() || null]),
  );
  const spaces = cashOnly.map((s) => ({
    ...s,
    contactPhone: phoneByIncubator.get(s.incubatorId) ?? null,
  }));

  const cities = Array.from(new Set(spaces.map((s) => s.city).filter(Boolean))).sort();
  return json({ spaces, cities });
}
