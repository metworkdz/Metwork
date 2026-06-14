'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Briefcase, ClipboardList, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Program, ProgramType } from '@/types/domain';
import type { Locale } from '@/i18n/config';

interface ProgramsMobileListProps {
  programs: Program[];
  typeLabel: Record<ProgramType, string>;
  createSlot: ReactNode;
  onRegistrations: (program: Program) => void;
  onEdit: (program: Program) => void;
  onDelete: (id: string) => void;
}

/**
 * Mobile-only (`lg:hidden`) card list for programs / trainings — replaces the
 * desktop table with cards showing cover, title, type, schedule, a seats /
 * registration progress bar, price, and quick actions (registrations, edit,
 * delete). Desktop keeps the existing `ListingManagementTable`.
 */
export function ProgramsMobileList({
  programs,
  typeLabel,
  createSlot,
  onRegistrations,
  onEdit,
  onDelete,
}: ProgramsMobileListProps) {
  const t = useTranslations('incubator.programs');
  const locale = useLocale() as Locale;

  return (
    <div className="space-y-3 lg:hidden">
      <div className="flex justify-end">{createSlot}</div>

      {programs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center">
          <Briefcase className="size-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (
        programs.map((p) => {
          const cover = p.imageUrls?.[0] ?? p.imageUrl;
          const ratio = p.seatsTotal === 0 ? 0 : p.seatsTaken / p.seatsTotal;
          return (
            <div
              key={p.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative h-28 w-full bg-muted">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={p.title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Briefcase className="size-8 text-muted-foreground/40" />
                  </div>
                )}
                <span className="absolute end-2 top-2 rounded-full bg-background/90 px-2 py-0.5 text-[0.6875rem] font-medium text-foreground">
                  {p.price === 0 ? 'Free' : formatCurrency(p.price, locale)}
                </span>
              </div>

              <div className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{p.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{p.city}</p>
                  </div>
                  <Badge variant="info" className="shrink-0">{typeLabel[p.type]}</Badge>
                </div>

                <p className="mt-1.5 text-xs text-muted-foreground">
                  {formatDate(p.startDate, locale)} → {formatDate(p.endDate, locale)}
                </p>

                <div className="mt-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{t('colSeats')}</span>
                    <span className="tabular-nums">{p.seatsTaken}/{p.seatsTotal}</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
                    />
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onRegistrations(p)}>
                    <ClipboardList className="size-4" />
                    {t('actionRegistrations')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onEdit(p)} aria-label={t('actionEdit')}>
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(p.id)}
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
