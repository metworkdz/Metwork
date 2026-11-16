'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Calendar, ClipboardList, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import { isUnlimited } from '@/lib/seat-limit';
import type { Event as PlatformEvent } from '@/types/domain';
import type { Locale } from '@/i18n/config';
import { CopyEventLinkButton } from '@/components/features/events/copy-event-link';

interface EventsMobileListProps {
  events: PlatformEvent[];
  createSlot: ReactNode;
  onRegistrations: (event: PlatformEvent) => void;
  onEdit: (event: PlatformEvent) => void;
  onDelete: (id: string) => void;
}

/**
 * Mobile-only (`lg:hidden`) card list for events — the same cards as the programs
 * page (cover, price chip, title, badge, date, link, attendance bar, quick
 * actions). Desktop keeps `ListingManagementTable`.
 */
export function EventsMobileList({ events, createSlot, onRegistrations, onEdit, onDelete }: EventsMobileListProps) {
  const t = useTranslations('incubator.eventsManager');
  const tVis = useTranslations('programVisibility');
  const locale = useLocale() as Locale;

  return (
    <div className="space-y-3 lg:hidden">
      <div className="flex justify-end">{createSlot}</div>

      {events.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center">
          <Calendar className="size-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (
        events.map((e) => {
          const cover = e.imageUrls?.[0] ?? e.imageUrl;
          const noLimit = isUnlimited(e);
          const ratio = e.capacity === 0 ? 0 : e.attendeeCount / e.capacity;
          return (
            <div
              key={e.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative h-28 w-full bg-muted">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={e.title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Calendar className="size-8 text-muted-foreground/40" />
                  </div>
                )}
                <span className="absolute end-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
                  {e.price === 0 ? t('free') : formatCurrency(e.price, locale)}
                </span>
              </div>

              <div className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{e.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{e.city}</p>
                  </div>
                  <Badge variant={e.isOnline ? 'info' : 'outline'} className="shrink-0">
                    {e.isOnline ? t('modeOnline') : t('modeInPerson')}
                  </Badge>
                </div>

                <p className="mt-1.5 text-xs text-muted-foreground">
                  {formatDate(e.eventDate, locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </p>

                {e.isActive === false ? (
                  <Badge variant="warning" className="mt-2">{tVis('draft')}</Badge>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <CopyEventLinkButton event={e} className="h-8 gap-1.5 px-2.5 text-xs" />
                  </div>
                )}

                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('colAttendance')}</span>
                    {/* Owner view: the real count; "No limit" replaces the ratio and bar. */}
                    <span className="tabular-nums">
                      {noLimit ? t('registeredNoLimit', { count: e.attendeeCount }) : `${e.attendeeCount}/${e.capacity}`}
                    </span>
                  </div>
                  {!noLimit && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                      />
                    </div>
                  )}
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onRegistrations(e)}>
                    <ClipboardList className="size-4" />
                    {t('actionRegistrations')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onEdit(e)} aria-label={t('actionEdit')}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(e.id)}
                    aria-label={t('actionDelete')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
