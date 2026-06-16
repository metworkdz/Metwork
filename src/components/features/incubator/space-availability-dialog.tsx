'use client';

/**
 * Manage-availability dialog for a single space.
 *
 * Airbnb-style month calendar (AvailabilityCalendar in `block` mode): tap a date
 * to block / unblock it for EVERYONE — public, guests, and the incubator's own
 * manual bookings — until it is unblocked. Optionally block a time range within
 * a date. Dates already taken by bookings are shown distinctly (read-only).
 *
 * Loads the full current block config (all months) up front, edits it in
 * memory, and PUTs the complete replacement set to
 * `PUT /api/incubator/spaces/:id/availability`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, X } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
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

interface Blackout { date: string; from?: string; to?: string }

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function SpaceAvailabilityDialog({ space, open, onOpenChange, onSaved }: Props) {
  const t = useTranslations('incubator.availability');
  const locale = useLocale() as Locale;

  const [month, setMonth] = useState(currentMonth());
  // Full-day blocks (all months) — the editable toggle set.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  // Time-range blocks (all months).
  const [blackouts, setBlackouts] = useState<Blackout[]>([]);
  // Read-only, current month only.
  const [fullyBooked, setFullyBooked] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time-range form.
  const [rangeDate, setRangeDate] = useState('');
  const [rangeFrom, setRangeFrom] = useState(space.openingTime ?? '09:00');
  const [rangeTo, setRangeTo] = useState(space.closingTime ?? '18:00');

  // Load the full block config once when the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/incubator/spaces/${space.id}/availability`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((data: { unavailableDates?: string[]; blackouts?: Blackout[] }) => {
        if (cancelled) return;
        setBlocked(new Set(data.unavailableDates ?? []));
        setBlackouts(data.blackouts ?? []);
      })
      .catch(() => { if (!cancelled) setError(t('loadError')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, space.id, t]);

  // Fully-booked days for the visible month (read-only display).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetch(`/api/incubator/spaces/${space.id}/availability?month=${month}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('month'))))
      .then((data: { fullyBookedDates?: string[] }) => {
        if (!cancelled) setFullyBooked(data.fullyBookedDates ?? []);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [open, space.id, month]);

  const toggleDate = useCallback((date: string) => {
    setBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }, []);

  function addRange() {
    if (!rangeDate || !rangeFrom || !rangeTo || rangeFrom >= rangeTo) {
      setError(t('rangeInvalid'));
      return;
    }
    setError(null);
    setBlackouts((prev) => [...prev, { date: rangeDate, from: rangeFrom, to: rangeTo }]);
  }
  function removeRange(i: number) {
    setBlackouts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/incubator/spaces/${space.id}/availability`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unavailableDates: [...blocked],
          blackouts: blackouts.filter((b) => b.from && b.to),
        }),
      });
      if (!res.ok) throw new Error('save');
      onSaved?.();
      onOpenChange(false);
    } catch {
      setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  // In block mode every non-past day is clickable; the calendar greys + strikes
  // whatever we pass as unavailable. We pass our editable blocked set ∪ the
  // read-only fully-booked days so both read as "not bookable"; toggling a
  // fully-booked day still just adds/removes a manual block, which is harmless.
  const unavailable = [...new Set([...blocked, ...fullyBooked])];

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
            <p className="text-xs text-muted-foreground">{t('tapHint')}</p>

            <AvailabilityCalendar
              month={month}
              onMonthChange={setMonth}
              mode="block"
              unavailableDates={unavailable}
              onSelectDate={toggleDate}
              locale={locale === 'ar' ? 'ar' : locale === 'fr' ? 'fr' : 'en'}
            />

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm border border-destructive/50 bg-destructive/15" />
                {t('legendBlocked')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-muted" />
                {t('legendFullyBooked')}
              </span>
            </div>

            {fullyBooked.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('fullyBookedNote', { dates: fullyBooked.map((d) => d.slice(8)).join(', ') })}
              </p>
            )}

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
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={addRange}>
                {t('addRange')}
              </Button>

              {blackouts.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {blackouts.map((b, i) => (
                    <li key={i} className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs">
                      <span className="tabular-nums">{b.date} · {b.from}–{b.to}</span>
                      <button type="button" onClick={() => removeRange(i)}
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button type="button" loading={saving} disabled={loading} onClick={() => void save()}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
