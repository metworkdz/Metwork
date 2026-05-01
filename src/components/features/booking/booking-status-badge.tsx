/**
 * Mapping of Booking.status → Badge variant + label.
 * Reused across entrepreneur (own bookings) and incubator (received bookings) views.
 */
import { Badge } from '@/components/ui/badge';
import type { BookingStatus } from '@/types/domain';

const map: Record<BookingStatus, { label: string; variant: React.ComponentProps<typeof Badge>['variant'] }> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'danger' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  REFUNDED: { label: 'Refunded', variant: 'info' },
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  const cfg = map[status];
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
