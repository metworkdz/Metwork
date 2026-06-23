'use client';

/**
 * Manage-availability dialog for a single space — the Airbnb-style OWNER editor.
 *
 * Reads the SAME canonical endpoint the public booking calendar reads
 * (`GET /api/spaces/:id/availability?from&to`) so the two views can never
 * disagree: `BLOCK` intervals → owner-blocked days, `BOOKING` intervals → days
 * taken by a booking (shown read-only).
 *
 * Selection: tap a day to toggle it into the pending selection, or PRESS-AND-DRAG
 * across days to paint a contiguous range (pointer events → mouse + touch). Then:
 *   • "Block dates"   → one POST   /api/incubator/spaces/:id/availability { dates }
 *   • "Unblock dates" → one DELETE /api/incubator/spaces/:id/availability { dates }
 * Both Prompt-1 APIs are additive and idempotent. A large block asks to confirm.
 * After a write we refetch so this view and the public calendar agree.
 *
 * Time-range blackouts (block only part of a day) use the same POST/DELETE with
 * a `ranges` body.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
import {
  computeDayInfos,
  monthRange,
  ownerBuckets,
  type AvailabilityIntervalDto,
  type SpaceAvailabilityResponse,
} from '@/lib/space-availability-view';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

interface SpaceLite {
  id: string;
  name: string;
  openingTime?: string | null;
  closingTime?: string | null;
}

interface Props {
  space: SpaceLite;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: () => void;
}

interface Blackout { date: string; from: string; to: string }

/** Selecting more than this many days asks for confirmation before blocking. */
const LARGE_BLOCK_THRESHOLD = 14;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function SpaceAvailabilityDialog({ space, open, onOpenChange, onSaved }: Props) {
  const t = useTranslations('incubator.availability');
  const locale = useLocale() as Locale;
  const calLocale = locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en';

  const [month, setMonth] = useState(currentMonth());
  const [avail, setAvail] = useState<SpaceAvailabilityResponse | null>(null);
  // Pending day selection (to block / unblock in one request).
  const [selection, setSelection] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time-range form.
  const [rangeDate, setRangeDate] = useState('');
  const [rangeFrom, setRangeFrom] = useState(space.openingTime ?? '09:00');
  const [rangeTo, setRangeTo] = useState(space.closingTime ?? '18:00');

  const fetchMonth = useCallback(
    (signal?: { cancelled: boolean }) => {
      const { from, to } = monthRange(month);
      return fetch(`/api/spaces/${space.id}/availability?from=${from}&to=${to}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
        .then((data: SpaceAvailabilityResponse) => {
          if (signal?.cancelled) return;
          setAvail(data && Array.isArray(data.intervals) ? data : null);
        });
    },
    [month, space.id],
  );

  // Load the visible month whenever the dialog opens or the month changes.
  useEffect(() => {
    if (!open) return;
    const signal = { cancelled: false };
    setLoading(true);
    setError(null);
    void fetchMonth(signal)
      .catch(() => { if (!signal.cancelled) setError(t('loadError')); })
      .finally(() => { if (!signal.cancelled) setLoading(false); });
    return () => { signal.cancelled = true; };
  }, [open, fetchMonth, t]);

  // Reset the pending selection each time the dialog opens.
  useEffect(() => {
    if (open) setSelection([]);
  }, [open]);

  const infos = useMemo(
    () => (avail ? computeDayInfos(avail, { unit: 'DAY' }) : []),
    [avail],
  );
  const { bookedDates, blockedDates } = useMemo(() => ownerBuckets(infos), [infos]);
  const blockedSet = useMemo(() => new Set(blockedDates), [blockedDates]);

  // Existing time-range blackouts for the visible month (partial BLOCK intervals).
  const blackouts = useMemo<Blackout[]>(() => {
    if (!avail) return [];
    return avail.intervals
      .filter((iv): iv is AvailabilityIntervalDto => iv.kind === 'BLOCK' && !iv.allDay)
      .map((iv) => ({
        date: iv.start.slice(0, 10),
        from: iv.start.slice(11, 16),
        to: iv.end.slice(11, 16),
      }));
  }, [avail]);

  // How much of the current selection is already blocked → drives Block vs Unblock.
  const selectedBlockedCount = useMemo(
    () => selection.filter((d) => blockedSet.has(d)).length,
    [selection, blockedSet],
  );

  async function writeBlocks(
    method: 'POST' | 'DELETE',
    body: { dates?: string[]; ranges?: Blackout[] },
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/incubator/spaces/${space.id}/availability`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('save');
      setSelection([]);
      await fetchMonth(); // refetch so this view and the public calendar agree
      onSaved?.();
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  function blockSelection() {
    if (selection.length === 0) return;
    if (selection.length > LARGE_BLOCK_THRESHOLD &&
        !window.confirm(t('confirmLargeBlock', { count: selection.length }))) {
      return;
    }
    void writeBlocks('POST', { dates: selection });
  }
  function unblockSelection() {
    const toUnblock = selection.filter((d) => blockedSet.has(d));
    if (toUnblock.length === 0) return;
    void writeBlocks('DELETE', { dates: toUnblock });
  }

  function addRange() {
    if (!rangeDate || !rangeFrom || !rangeTo || rangeFrom >= rangeTo) {
      setError(t('rangeInvalid'));
      return;
    }
    setError(null);
    void writeBlocks('POST', { ranges: [{ date: rangeDate, from: rangeFrom, to: rangeTo }] });
  }
  function removeRange(b: Blackout) {
    void writeBlocks('DELETE', { ranges: [b] });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { name: space.name })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="me-2 size-5 animate-spin" />
            {t('loading')}
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <p className="text-xs text-muted-foreground">{t('dragHint')}</p>

            <AvailabilityCalendar
              month={month}
              onMonthChange={setMonth}
              mode="block"
              bookedDates={bookedDates}
              blockedDates={blockedDates}
              selectedDates={selection}
              onSelectionChange={setSelection}
              onSelectDate={() => {}}
              showLegend
              locale={calLocale}
            />

            {/* Block / unblock actions for the current selection */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {t('selectionCount', { count: selection.length })}
              </span>
              <div className="ms-auto flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving || selectedBlockedCount === 0}
                  onClick={unblockSelection}
                >
                  {t('unblockSelected')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={saving}
                  disabled={selection.length === 0}
                  onClick={blockSelection}
                >
                  {t('blockSelected')}
                </Button>
              </div>
            </div>

            {/* Time-range blocks */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-sm font-medium">{t('rangeTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('rangeHint')}</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div>
                  <Label htmlFor="av-rd" className="text-xs text-muted-foreground">{t('rangeDate')}</Label>
                  <Input id="av-rd" type="date" className="mt-1" value={rangeDate}
                    onChange={(e) => setRangeDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="av-rf" className="text-xs text-muted-foreground">{t('rangeFrom')}</Label>
                  <Input id="av-rf" type="time" className="mt-1" value={rangeFrom}
                    onChange={(e) => setRangeFrom(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="av-rt" className="text-xs text-muted-foreground">{t('rangeTo')}</Label>
                  <Input id="av-rt" type="time" className="mt-1" value={rangeTo}
                    onChange={(e) => setRangeTo(e.target.value)} />
                </div>
              </div>
              <Button type="button" size="sm" variant="outline" className="mt-2"
                loading={saving} onClick={addRange}>
                {t('addRange')}
              </Button>

              {blackouts.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {blackouts.map((b) => (
                    <li key={`${b.date}-${b.from}-${b.to}`}
                      className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs">
                      <span className="tabular-nums">{b.date} · {b.from}–{b.to}</span>
                      <button type="button" onClick={() => removeRange(b)}
                        className={cn('rounded p-1 text-muted-foreground hover:text-destructive')}
                        aria-label={t('removeRange')}>
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
