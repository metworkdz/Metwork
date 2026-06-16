'use client';

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Building2, CalendarClock, Pencil, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import type { Space, SpaceCategory } from '@/types/domain';
import type { Locale } from '@/i18n/config';

interface SpacesMobileListProps {
  spaces: Space[];
  categoryLabel: Record<SpaceCategory, string>;
  /** The create-space trigger (SpaceFormDialog default button). */
  createSlot: ReactNode;
  onEdit: (space: Space) => void;
  onDelete: (id: string) => void;
  onManageAvailability: (space: Space) => void;
}

/**
 * Mobile-only (`lg:hidden`) card list for incubator/trainer spaces — replaces
 * the horizontally-scrolling desktop table with tap-friendly cards: cover
 * thumbnail, name, type, status pill, pricing, and quick edit/delete.
 * Desktop keeps the existing `ListingManagementTable`.
 */
export function SpacesMobileList({
  spaces,
  categoryLabel,
  createSlot,
  onEdit,
  onDelete,
  onManageAvailability,
}: SpacesMobileListProps) {
  const t = useTranslations('incubator.spaces');
  const locale = useLocale() as Locale;

  return (
    <div className="space-y-3 lg:hidden">
      <div className="flex justify-end">{createSlot}</div>

      {spaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-10 text-center">
          <Building2 className="size-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('emptyDescription')}</p>
        </div>
      ) : (
        spaces.map((s) => {
          const cover = s.imageUrls?.[0] ?? s.imageUrl;
          const price =
            s.pricePerHour != null
              ? `${formatCurrency(s.pricePerHour, locale)}/h`
              : s.pricePerDay != null
                ? `${formatCurrency(s.pricePerDay, locale)}/d`
                : s.pricePerMonth != null
                  ? `${formatCurrency(s.pricePerMonth, locale)}/mo`
                  : null;
          return (
            <div
              key={s.id}
              className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative h-28 w-full bg-muted">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt={s.name} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <Building2 className="size-8 text-muted-foreground/40" />
                  </div>
                )}
              </div>

              <div className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{s.city}</p>
                  </div>
                  {price && <span className="shrink-0 text-sm font-medium">{price}</span>}
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <Badge variant="outline">{categoryLabel[s.category]}</Badge>
                  <span className="text-xs text-muted-foreground">{s.capacity} {t('colCapacity').toLowerCase()}</span>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={() => onEdit(s)}>
                    <Pencil className="size-4" />
                    {t('actionEdit')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => onManageAvailability(s)}
                    aria-label={t('actionAvailability')}
                  >
                    <CalendarClock className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(s.id)}
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
