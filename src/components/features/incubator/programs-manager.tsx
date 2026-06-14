'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Briefcase, ClipboardList, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { ProgramFormDialog } from './program-form-dialog';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Program, ProgramType } from '@/types/domain';
import type { Locale } from '@/i18n/config';

const typeLabel: Record<ProgramType, string> = {
  INCUBATION:   'Incubation',
  ACCELERATION: 'Acceleration',
  TRAINING:     'Training',
  BOOTCAMP:     'Bootcamp',
  WORKSHOP:     'Workshop',
};

export function ProgramsManager() {
  const locale = useLocale() as Locale;
  const t      = useTranslations('incubator.programs');
  const router = useRouter();
  const [rows, setRows] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // FIX: BUG-2 — edit state
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);

  async function fetchPrograms() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/programs', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load programs');
      const data = await res.json() as { items: Program[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading programs');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchPrograms();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm('Delete this program? This cannot be undone.')) return;
    const res = await fetch(`/api/incubator/programs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRows((prev) => prev.filter((p) => p.id !== id));
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string };
      alert(body.message ?? 'Failed to delete program. Please try again.');
    }
  }

  const columns: ListingColumn<Program>[] = [
    {
      key: 'title',
      label: t('colProgram'),
      render: (p) => (
        <div>
          <div className="font-medium">{p.title}</div>
          <div className="text-xs text-muted-foreground">{p.city}</div>
        </div>
      ),
    },
    {
      key: 'type',
      label: t('colType'),
      render: (p) => <Badge variant="info">{typeLabel[p.type]}</Badge>,
    },
    {
      key: 'dates',
      label: t('colSchedule'),
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
      label: t('colSeats'),
      render: (p) => {
        const ratio = p.seatsTotal === 0 ? 0 : p.seatsTaken / p.seatsTotal;
        return (
          <div>
            <div className="tabular-nums">
              {p.seatsTaken}/{p.seatsTotal}
            </div>
            <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary"
                style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'price',
      label: t('colPrice'),
      align: 'end',
      render: (p) =>
        p.price === 0 ? (
          <Badge variant="success">Free</Badge>
        ) : (
          <span className="tabular-nums">{formatCurrency(p.price, locale)}</span>
        ),
    },
    {
      key: 'payment',
      label: t('colPayment'),
      render: (p) => (
        <span className="text-xs text-muted-foreground">
          {(p.acceptedPaymentMethods ?? ['ONLINE']).join(' · ')}
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
        rowKey={(p) => p.id}
        createSlot={<ProgramFormDialog onCreated={() => void fetchPrograms()} />}
        emptyIcon={<Briefcase className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        // FIX: BUG-2 — real edit/delete actions
        actions={[
          {
            label: t('actionRegistrations'),
            icon: <ClipboardList className="size-4" />,
            onSelect: (p) => router.push(`/dashboard/incubator/programs/${p.id}` as Parameters<typeof router.push>[0]),
          },
          {
            label: t('actionEdit'),
            icon: <Pencil className="size-4" />,
            onSelect: (p) => setEditingProgram(p),
          },
          {
            label: t('actionDelete'),
            icon: <Trash2 className="size-4" />,
            onSelect: (p) => void handleDelete(p.id),
            destructive: true,
          },
        ]}
      />
      {/* FIX: BUG-2 — edit dialog rendered outside the table, controlled by editingProgram state */}
      {editingProgram && (
        <ProgramFormDialog
          onCreated={() => { void fetchPrograms(); setEditingProgram(null); }}
          editId={editingProgram.id}
          initialData={{
            title: editingProgram.title,
            description: editingProgram.description,
            type: editingProgram.type,
            city: editingProgram.city,
            price: editingProgram.price,
            onlinePrice: editingProgram.onlinePrice,
            cashPrice: editingProgram.cashPrice,
            seatsTotal: editingProgram.seatsTotal,
            deadline: editingProgram.deadline,
            startDate: editingProgram.startDate,
            endDate: editingProgram.endDate,
            acceptedPaymentMethods: editingProgram.acceptedPaymentMethods ?? ['ONLINE'],
            cashDepositType: editingProgram.cashDepositType,
            cashDepositValue: editingProgram.cashDepositValue,
            imageUrl: editingProgram.imageUrl,
            imageUrls: editingProgram.imageUrls,
          }}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingProgram(null); }}
        />
      )}
    </>
  );
}
