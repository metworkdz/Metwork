'use client';

import { useLocale } from 'next-intl';
import { Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Program, ProgramType } from '@/types/domain';
import type { Locale } from '@/i18n/config';

const typeLabel: Record<ProgramType, string> = {
  INCUBATION: 'Incubation',
  ACCELERATION: 'Acceleration',
  TRAINING: 'Training',
  BOOTCAMP: 'Bootcamp',
  WORKSHOP: 'Workshop',
};

export function ProgramsManager({ initial }: { initial: Program[] }) {
  const locale = useLocale() as Locale;

  const columns: ListingColumn<Program>[] = [
    {
      key: 'title',
      label: 'Program',
      render: (p) => (
        <div>
          <div className="font-medium">{p.title}</div>
          <div className="text-xs text-muted-foreground">{p.city}</div>
        </div>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      render: (p) => <Badge variant="info">{typeLabel[p.type]}</Badge>,
    },
    {
      key: 'dates',
      label: 'Schedule',
      render: (p) => (
        <div className="text-sm">
          <div>{formatDate(p.startDate, locale)}</div>
          <div className="text-xs text-muted-foreground">
            → {formatDate(p.endDate, locale)}
          </div>
        </div>
      ),
    },
    {
      key: 'seats',
      label: 'Seats',
      render: (p) => {
        const ratio = p.seatsTotal === 0 ? 0 : p.seatsTaken / p.seatsTotal;
        return (
          <div>
            <div className="tabular-nums">
              {p.seatsTaken}/{p.seatsTotal}
            </div>
            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary-500"
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
      render: (p) =>
        p.price === 0 ? (
          <Badge variant="success">Free</Badge>
        ) : (
          <span className="tabular-nums">{formatCurrency(p.price, locale)}</span>
        ),
    },
  ];

  return (
    <ListingManagementTable
      rows={initial}
      columns={columns}
      rowKey={(p) => p.id}
      onCreate={() => {}}
      emptyIcon={<Briefcase className="size-5 text-muted-foreground" />}
      emptyTitle="No programs yet"
      emptyDescription="Create incubation, acceleration, or training programs."
    />
  );
}
