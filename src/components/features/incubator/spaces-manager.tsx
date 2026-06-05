'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, Loader2, Pencil, Trash2 } from 'lucide-react';
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
  const t      = useTranslations('incubator.spaces');
  const [rows, setRows] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // FIX: BUG-2 — edit/delete state
  const [editingSpace, setEditingSpace] = useState<Space | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchSpaces();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this space? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/incubator/spaces/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setRows((prev) => prev.filter((s) => s.id !== id));
      } else {
        const body = await res.json().catch(() => ({})) as { message?: string };
        alert(body.message ?? 'Failed to delete space. Please try again.');
      }
    } finally {
      setDeletingId(null);
    }
  }

  const columns: ListingColumn<Space>[] = [
    {
      key: 'name',
      label: t('colSpace'),
      render: (s) => (
        <div>
          <div className="font-medium">{s.name}</div>
          <div className="text-xs text-muted-foreground">{s.city}</div>
        </div>
      ),
    },
    {
      key: 'category',
      label: t('colCategory'),
      render: (s) => <Badge variant="outline">{categoryLabel[s.category]}</Badge>,
    },
    {
      key: 'capacity',
      label: t('colCapacity'),
      render: (s) => `${s.capacity} seats`,
    },
    {
      key: 'pricing',
      label: t('colPricing'),
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
      label: t('colPayment'),
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
    <>
      <ListingManagementTable
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        createSlot={<SpaceFormDialog onCreated={() => void fetchSpaces()} />}
        emptyIcon={<Building2 className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        // FIX: BUG-2 — real edit/delete actions
        actions={[
          {
            label: t('actionEdit'),
            icon: <Pencil className="size-4" />,
            onSelect: (s) => setEditingSpace(s),
          },
          {
            label: t('actionDelete'),
            icon: <Trash2 className="size-4" />,
            onSelect: (s) => void handleDelete(s.id),
            destructive: true,
          },
        ]}
      />
      {/* FIX: BUG-2 — edit dialog rendered outside the table, controlled by editingSpace state */}
      {editingSpace && (
        <SpaceFormDialog
          onCreated={() => { void fetchSpaces(); setEditingSpace(null); }}
          editId={editingSpace.id}
          initialData={{
            name: editingSpace.name,
            description: editingSpace.description,
            category: editingSpace.category,
            city: editingSpace.city,
            pricePerHour: editingSpace.pricePerHour,
            pricePerDay: editingSpace.pricePerDay,
            pricePerMonth: editingSpace.pricePerMonth,
            capacity: editingSpace.capacity,
            amenities: editingSpace.amenities ?? [],
            acceptedPaymentMethods: editingSpace.acceptedPaymentMethods ?? ['ONLINE'],
            cashDepositType: editingSpace.cashDepositType,
            cashDepositValue: editingSpace.cashDepositValue,
            imageUrl: editingSpace.imageUrl,
            imageUrls: editingSpace.imageUrls,
            workingDays: editingSpace.workingDays ?? [1, 2, 3, 4, 5],
            openingTime: editingSpace.openingTime ?? '09:00',
            closingTime: editingSpace.closingTime ?? '18:00',
          }}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingSpace(null); }}
        />
      )}
      {/* suppress unused deletingId warning */}
      {deletingId && null}
    </>
  );
}
