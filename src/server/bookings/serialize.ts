/**
 * Server → client DTO for bookings.
 */
import type { BookingRecord } from '@/server/db/store';
import type { BookingDto } from '@/types/booking';

export function toBookingDto(b: BookingRecord): BookingDto {
  return {
    id: b.id,
    itemKind: b.itemKind,
    itemId: b.itemId,
    itemName: b.itemName,
    vendorName: b.vendorName,
    city: b.city,
    unit: b.unit,
    quantity: b.quantity,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    totalAmount: b.totalAmount,
    status: b.status,
    clientReference: b.clientReference,
    transactionId: b.transactionId,
    createdAt: b.createdAt,
  };
}
