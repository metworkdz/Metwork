'use client';

import { useLocale } from 'next-intl';
import { Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Event as PlatformEvent } from '@/types/domain';
import type { Locale } from '@/i18n/config';

export function EventsManager({ initial }: { initial: PlatformEvent[] }) {
  const locale = useLocale() as Locale;

  const columns: ListingColumn<PlatformEvent>[] = [
    {
      key: 'title',
      label: 'Event',
      render: (e) => (
        <div>
          <div className="font-medium">{e.title}</div>
          <div className="text-xs text-muted-foreground">{e.city}</div>
        </div>
      ),
    },
    {
      key: 'when',
      label: 'When',
      render: (e) => (
        <div className="text-sm">
          {formatDate(e.eventDate, locale, { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      ),
    },
    {
      key: 'mode',
      label: 'Mode',
      render: (e) =>
        e.isOnline ? <Badge variant="info">Online</Badge> : <Badge variant="outline">In person</Badge>,
    },
    {
      key: 'attendance',
      label: 'Attendance',
      render: (e) => {
        const ratio = e.capacity === 0 ? 0 : e.attendeeCount / e.capacity;
        return (
          <div>
            <div className="tabular-nums">
              {e.attendeeCount}/{e.capacity}
            </div>
            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'price',
      label: 'Price',
      align: 'end',
      render: (e) =>
        e.price === 0 ? (
          <Badge variant="success">Free</Badge>
        ) : (
          <span className="tabular-nums">{formatCurrency(e.price, locale)}</span>
        ),
    },
  ];

  return (
    <ListingManagementTable
      rows={initial}
      columns={columns}
      rowKey={(e) => e.id}
      onCreate={() => {}}
      emptyIcon={<Calendar className="size-5 text-muted-foreground" />}
      emptyTitle="No events yet"
      emptyDescription="Schedule pitch nights, demo days, and meetups."
    />
  );
}
