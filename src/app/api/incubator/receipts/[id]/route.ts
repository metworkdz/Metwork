/**
 * GET /api/incubator/receipts/[id]
 *
 * Returns full receipt data for a booking owned by the calling incubator.
 * Used to render the printable receipt modal.
 */
import { requireApiRole } from '@/server/auth/api-guards';
import { db } from '@/server/db/store';
import { json, jsonError } from '@/server/http/json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireApiRole(['INCUBATOR', 'ADMIN']);
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const data = await db.read();

  const incubator = data.incubators.find((i) => i.managerId === guard.user.id);
  if (!incubator && guard.user.role !== 'ADMIN') {
    return jsonError(404, 'INCUBATOR_NOT_FOUND', 'No incubator profile found');
  }

  const booking = data.bookings.find((b) => b.id === id);
  if (!booking) return jsonError(404, 'NOT_FOUND', 'Booking not found');

  // Verify ownership if caller is INCUBATOR (not ADMIN)
  if (guard.user.role === 'INCUBATOR' && incubator) {
    const ownedSpaceIds = new Set(
      data.incubatorSpaces.filter((s) => s.incubatorId === incubator.id).map((s) => s.id),
    );
    const ownedProgramIds = new Set(
      data.incubatorPrograms.filter((p) => p.incubatorId === incubator.id).map((p) => p.id),
    );
    const isOwned =
      (booking.itemKind === 'SPACE' && ownedSpaceIds.has(booking.itemId)) ||
      (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId));
    if (!isOwned) return jsonError(403, 'FORBIDDEN', 'Not your booking');
  }

  const customer = booking.userId ? data.users.find((u) => u.id === booking.userId) : null;
  const tx = booking.transactionId
    ? data.transactions.find((t) => t.id === booking.transactionId) ?? null
    : null;

  // Resolve incubator for legal header
  const resolvedIncubator = incubator ?? data.incubators.find((i) => {
    const ownedSpaceIds = new Set(data.incubatorSpaces.filter((s) => s.incubatorId === i.id).map((s) => s.id));
    const ownedProgramIds = new Set(data.incubatorPrograms.filter((p) => p.incubatorId === i.id).map((p) => p.id));
    return (booking.itemKind === 'SPACE' && ownedSpaceIds.has(booking.itemId)) ||
           (booking.itemKind === 'PROGRAM' && ownedProgramIds.has(booking.itemId));
  });

  return json({
    receipt: {
      bookingId: booking.id,
      issuedAt: new Date().toISOString(),
      source: booking.source ?? 'online',
      paymentMethod: booking.paymentMethod ?? 'wallet',
      vendor: resolvedIncubator ? {
        name: resolvedIncubator.name,
        logoUrl: resolvedIncubator.logoUrl ?? null,
        address: resolvedIncubator.address ?? null,
        commercialRegNumber: resolvedIncubator.commercialRegNumber ?? null,
        nif: resolvedIncubator.nif ?? null,
      } : null,
      customer: {
        name: customer?.fullName ?? booking.clientName ?? 'Unknown',
        email: customer?.email ?? booking.clientEmail ?? '',
        phone: customer?.phone ?? booking.clientPhone ?? '',
        city: customer?.city ?? '',
        idNumber: booking.clientIdNumber ?? null,
      },
      item: {
        kind: booking.itemKind,
        name: booking.itemName,
        vendor: booking.vendorName,
        city: booking.city,
        unit: booking.unit,
        quantity: booking.quantity,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      },
      payment: {
        amount: booking.totalAmount,
        currency: 'DZD',
        status: booking.status,
        method: booking.paymentMethod ?? 'wallet',
        transactionRef: tx?.reference ?? booking.clientReference,
        paidAt: tx?.completedAt ?? booking.createdAt,
      },
    },
  });
}
