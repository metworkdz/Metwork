'use client';

import { useLocale } from 'next-intl';
import { Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { formatCurrency } from '@/lib/format';
import type { Space, SpaceCategory } from '@/types/domain';
import type { Locale } from '@/i18n/config';

const categoryLabel: Record<SpaceCategory, string> = {
  COWORKING: 'Coworking',
  PRIVATE_OFFICE: 'Private office',
  TRAINING_ROOM: 'Training room',
  DOMICILIATION: 'Domiciliation',
};

export function SpacesManager({ initial }: { initial: Space[] }) {
  const locale = useLocale() as Locale;

  const columns: ListingColumn<Space>[] = [
    {
      key: 'name',
      label: 'Space',
      render: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">{s.city}</div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (s) => <Badge variant="outline">{categoryLabel[s.category]}</Badge>,
    },
    {
      key: 'capacity',
      label: 'Capacity',
      render: (s) => `${s.capacity} seats`,
    },
    {
      key: 'pricing',
      label: 'Pricing',
      align: 'end',
      render: (s) => (
        <div className="text-end text-sm">
          {s.pricePerHour != null && (
            <div>{formatCurrency(s.pricePerHour, locale)}/hr</div>
          )}
          {s.pricePerDay != null && (
            <div className="text-xs text-muted-foreground">
              {formatCurrency(s.pricePerDay, locale)}/day
            </div>
          )}
          {s.pricePerMonth != null && (
            <div className="text-xs text-muted-foreground">
              {formatCurrency(s.pricePerMonth, locale)}/mo
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'rating',
      label: 'Rating',
      align: 'end',
      render: (s) =>
        s.rating != null ? (
          <span className="tabular-nums">
            {s.rating.toFixed(1)}{' '}
            <span className="text-xs text-muted-foreground">({s.reviewCount})</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">No reviews</span>
        ),
    },
  ];

  return (
    <ListingManagementTable
      rows={initial}
      columns={columns}
      rowKey={(s) => s.id}
      onCreate={() => {}}
      emptyIcon={<Building2 className="size-5 text-muted-foreground" />}
      emptyTitle="No spaces yet"
      emptyDescription="Add coworking floors, private offices, or training rooms."
    />
  );
}
