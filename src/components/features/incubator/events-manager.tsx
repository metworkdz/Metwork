'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Calendar, ClipboardList, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { EventFormDialog } from './event-form-dialog';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Event as PlatformEvent } from '@/types/domain';
import type { Locale } from '@/i18n/config';

export function EventsManager() {
  const t = useTranslations('incubator.eventsManager');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [rows, setRows] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  // FIX: BUG-2 — edit state
  const [editingEvent, setEditingEvent] = useState<PlatformEvent | null>(null);
  // FIX: BUG-5 — cash allowed only for active FLAT plan
  const [cashEnabled, setCashEnabled] = useState(true);

  async function fetchEvents() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/events', { cache: 'no-store' });
      if (!res.ok) throw new Error(t('errorLoad'));
      const data = await res.json() as { items: PlatformEvent[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchEvents();
    // FIX: BUG-5 — fetch subscription to determine if CASH is allowed
    fetch('/api/incubator/subscription', { cache: 'no-store' })
      .then((r) => r.ok ? r.json() as Promise<{ subscriptionCode: string; isActive: boolean }> : null)
      .then((sub) => {
        if (sub) {
          // FIX: BUG-5 — cash only allowed for active FLAT plan
          setCashEnabled(sub.subscriptionCode === 'FLAT' && sub.isActive);
        }
      })
      .catch(() => { /* ignore subscription fetch errors */ });
  }, []);

  async function handleDelete(id: string) {
    if (!confirm(t('confirmDelete'))) return;
    const res = await fetch(`/api/incubator/events/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setRows((prev) => prev.filter((e) => e.id !== id));
    } else {
      const body = await res.json().catch(() => ({})) as { message?: string };
      alert(body.message ?? t('errorDelete'));
    }
  }

  const columns: ListingColumn<PlatformEvent>[] = [
    {
      key: 'title',
      label: t('colEvent'),
      render: (e) => (
        <div>
          <div className="font-medium">{e.title}</div>
          <div className="text-xs text-muted-foreground">{e.city}</div>
        </div>
      ),
    },
    {
      key: 'when',
      label: t('colWhen'),
      render: (e) => (
        <div className="text-sm">
          {formatDate(e.eventDate, locale, { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
      ),
    },
    {
      key: 'mode',
      label: t('colMode'),
      render: (e) =>
        e.isOnline ? <Badge variant="info">{t('modeOnline')}</Badge> : <Badge variant="outline">{t('modeInPerson')}</Badge>,
    },
    {
      key: 'attendance',
      label: t('colAttendance'),
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
      label: t('colPrice'),
      align: 'end',
      render: (e) =>
        e.price === 0 ? (
          <Badge variant="success">{t('free')}</Badge>
        ) : (
          <span className="tabular-nums">{formatCurrency(e.price, locale)}</span>
        ),
    },
    {
      key: 'payment',
      label: t('colPayment'),
      render: (e) => (
        <span className="text-xs text-muted-foreground">
          {(e.acceptedPaymentMethods ?? ['ONLINE']).join(' · ')}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        {t('loading')}
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
        rowKey={(e) => e.id}
        createSlot={<EventFormDialog onCreated={() => void fetchEvents()} cashEnabled={cashEnabled} />}
        emptyIcon={<Calendar className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        // FIX: BUG-2 — real edit/delete actions
        actions={[
          {
            label: t('actionRegistrations'),
            icon: <ClipboardList className="size-4" />,
            onSelect: (e) => router.push(`/dashboard/incubator/events/${e.id}` as Parameters<typeof router.push>[0]),
          },
          {
            label: t('actionEdit'),
            icon: <Pencil className="size-4" />,
            onSelect: (e) => setEditingEvent(e),
          },
          {
            label: t('actionDelete'),
            icon: <Trash2 className="size-4" />,
            onSelect: (e) => void handleDelete(e.id),
            destructive: true,
          },
        ]}
      />
      {/* FIX: BUG-2 — edit dialog rendered outside the table, controlled by editingEvent state */}
      {editingEvent && (
        <EventFormDialog
          onCreated={() => { void fetchEvents(); setEditingEvent(null); }}
          editId={editingEvent.id}
          initialData={{
            title: editingEvent.title,
            description: editingEvent.description,
            city: editingEvent.city,
            price: editingEvent.price,
            capacity: editingEvent.capacity,
            isOnline: editingEvent.isOnline,
            eventDate: editingEvent.eventDate,
            acceptedPaymentMethods: editingEvent.acceptedPaymentMethods ?? ['ONLINE'],
            imageUrl: editingEvent.imageUrl,
          }}
          open={true}
          onOpenChange={(v) => { if (!v) setEditingEvent(null); }}
          cashEnabled={cashEnabled}
        />
      )}
    </>
  );
}
