'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Building2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { SpaceFormDialog } from './space-form-dialog';
import { formatCurrency } from '@/lib/format';
import type { Space, SpaceCategory } from '@/types/domain';
import type { Locale } from '@/i18n/config';

const categoryLabel: Record<SpaceCategory, string> = {
  COWORKING:      'Coworking',
  PRIVATE_OFFICE: 'Private office',
  TRAINING_ROOM:  'Training room',
  DOMICILIATION:  'Domiciliation',
};

export function SpacesManager() {
  const locale = useLocale() as Locale;
  const [rows, setRows] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function fetchSpaces() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/spaces', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load spaces');
      const data = await res.json() as { items: Space[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading spaces');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchSpaces(); }, []);

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
      key: 'payment',
      label: 'Payment',
      render: (s) => (
        <span className="text-xs text-muted-foreground">
          {(s.acceptedPaymentMethods ?? ['ONLINE']).join(' · ')}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {fetchError}
      </div>
    );
  }

  return (
    <ListingManagementTable
      rows={rows}
      columns={columns}
      rowKey={(s) => s.id}
      createSlot={<SpaceFormDialog onCreated={() => void fetchSpaces()} />}
      emptyIcon={<Building2 className="size-5 text-muted-foreground" />}
      emptyTitle="No spaces yet"
      emptyDescription="Add coworking floors, private offices, or training rooms."
    />
  );
}
