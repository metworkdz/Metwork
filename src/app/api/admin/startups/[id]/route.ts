/**
 * GET    /api/admin/startups/:id — admin-only full detail (founder joined in).
 * DELETE /api/admin/startups/:id — admin-only hard delete.
 *
 * Deletion semantics (decision D2): savedStartups bookmarks referencing this
 * listing are cascade-deleted (a bookmark to a gone listing is meaningless).
 * investorContacts are deliberately left untouched — each row already carries
 * a frozen startupName/founderName snapshot taken at contact-creation time, so
 * it stays a readable historical record of investor outreach even after the
 * listing itself is gone. investments are never touched — startupId is
 * nullable there and the record never joins back to a live listing.
 */
import type { NextRequest } from 'next/server';
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { toStartupDto } from '@/server/startups/serialize';
import { json, jsonError, noContent } from '@/server/http/json';
import { appendAuditLog } from '@/server/audit/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const data = await db.read();
  const listing = data.startupListings.find((l) => l.id === id);
  if (!listing) return jsonError(404, 'NOT_FOUND', 'Startup not found');

  const founder = data.users.find((u) => u.id === listing.founderId);

  return json({
    startup: {
      ...toStartupDto(listing),
      founderName: founder?.fullName ?? null,
      founderEmail: founder?.email ?? null,
      founderPhone: founder?.phone ?? null,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const guard = await requireApiRole(['ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;

  const result = await db.update((store) => {
    const idx = store.startupListings.findIndex((l) => l.id === id);
    if (idx === -1) return null;

    const listing = store.startupListings[idx]!;
    store.startupListings.splice(idx, 1);

    // Cascade: bookmarks pointing at a gone listing are meaningless.
    store.savedStartups = (store.savedStartups ?? []).filter((s) => s.startupId !== id);

    // Deliberately NOT touching investorContacts — kept as historical record.

    return { name: listing.name };
  });

  if (!result) return jsonError(404, 'NOT_FOUND', 'Startup not found');

  await appendAuditLog({
    adminId: guard.user.id,
    adminEmail: guard.user.email,
    action: 'STARTUP_DELETED',
    targetType: 'startup',
    targetId: id,
    details: { deletedName: result.name },
  }).catch(() => undefined);

  return noContent();
}
