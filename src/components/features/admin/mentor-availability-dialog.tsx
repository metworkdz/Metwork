'use client';

/**
 * Admin availability editor for a single mentor.
 *
 *   - Weekly template: per weekday, add/remove "HH:MM–HH:MM" ranges.
 *   - Blocked dates: the shared AvailabilityCalendar in "block" mode — click a
 *     day to toggle it unavailable.
 *   - Saves via PATCH /api/admin/mentors/:id/availability and re-syncs the
 *     parent with the returned mentor DTO.
 *
 * Validation mirrors the server schema (end > start, no overlapping ranges)
 * so the admin gets instant feedback before the round-trip.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
import { mentorsService } from '@/services/mentors.service';
import { ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Mentor, AvailabilityTimeRange } from '@/types/mentor';

interface MentorAvailabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mentor: Mentor | null;
  onSaved: (mentor: Mentor) => void;
}

type CalLocale = 'en' | 'fr' | 'ar';
type WeeklyState = AvailabilityTimeRange[][]; // index 0..6 = Sun..Sat

const TZ_OPTIONS = ['Africa/Algiers', 'Europe/Paris', 'Europe/London', 'UTC'];

function emptyWeek(): WeeklyState {
  return Array.from({ length: 7 }, () => []);
}

function weekFromMentor(m: Mentor): WeeklyState {
  const week = emptyWeek();
  for (const day of m.weeklyAvailability ?? []) {
    if (day.weekday >= 0 && day.weekday <= 6) {
      week[day.weekday] = day.slots.map((s) => ({ start: s.start, end: s.end }));
    }
  }
  return week;
}

function toMin(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function MentorAvailabilityDialog({
  open,
  onOpenChange,
  mentor,
  onSaved,
}: MentorAvailabilityDialogProps) {
  const t = useTranslations('admin.mentorAvailability');
  const rawLocale = useLocale();
  const locale: CalLocale = rawLocale === 'fr' ? 'fr' : rawLocale === 'ar' ? 'ar' : 'en';

  const [week, setWeek] = useState<WeeklyState>(emptyWeek);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [timezone, setTimezone] = useState<string>('Africa/Algiers');
  const [calMonth, setCalMonth] = useState<string>(currentMonth);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Localized long weekday names (Sun..Sat) via Intl — no translation table.
  const weekdayNames = useMemo(() => {
    const tag = locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-US';
    const fmt = new Intl.DateTimeFormat(tag, { weekday: 'long' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))));
  }, [locale]);

  useEffect(() => {
    if (!open || !mentor) return;
    setWeek(weekFromMentor(mentor));
    setBlocked([...(mentor.blockedDates ?? [])]);
    setTimezone(mentor.availabilityTimezone || 'Africa/Algiers');
    setCalMonth(currentMonth());
    setError(null);
  }, [open, mentor]);

  function addRange(weekday: number) {
    setWeek((w) => {
      const next = w.map((r) => [...r]);
      next[weekday]!.push({ start: '09:00', end: '17:00' });
      return next;
    });
  }

  function removeRange(weekday: number, idx: number) {
    setWeek((w) => {
      const next = w.map((r) => [...r]);
      next[weekday]!.splice(idx, 1);
      return next;
    });
  }

  function updateRange(weekday: number, idx: number, key: 'start' | 'end', value: string) {
    setWeek((w) => {
      const next = w.map((r) => r.map((s) => ({ ...s })));
      next[weekday]![idx]![key] = value;
      return next;
    });
  }

  function toggleBlocked(date: string) {
    setBlocked((b) => (b.includes(date) ? b.filter((d) => d !== date) : [...b, date]));
  }

  /** Client-side mirror of the server validation. Returns an error key or null. */
  function validate(): string | null {
    for (let wd = 0; wd < 7; wd++) {
      const ranges = week[wd]!;
      const intervals: Array<{ start: number; end: number }> = [];
      for (const r of ranges) {
        const start = toMin(r.start);
        const end = toMin(r.end);
        if (Number.isNaN(start) || Number.isNaN(end)) return t('errorInvalidTime');
        if (end <= start) return t('errorEndBeforeStart');
        intervals.push({ start, end });
      }
      const sorted = [...intervals].sort((a, b) => a.start - b.start);
      for (let k = 1; k < sorted.length; k++) {
        if (sorted[k]!.start < sorted[k - 1]!.end) return t('errorOverlap');
      }
    }
    return null;
  }

  async function onSave() {
    if (!mentor) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const weeklyAvailability = week
        .map((slots, weekday) => ({ weekday, slots }))
        .filter((d) => d.slots.length > 0);
      const saved = await mentorsService.updateAvailability(mentor.id, {
        weeklyAvailability,
        blockedDates: blocked,
        availabilityTimezone: timezone,
      });
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError) setError(err.message || t('saveFailed'));
      else setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (!mentor) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('manageFor', { name: mentor.fullName })}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          {/* Weekly template */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t('weeklyTitle')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('weeklyHint')}</p>
            </div>

            <div className="space-y-2">
              {weekdayNames.map((name, wd) => (
                <div key={wd} className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium capitalize">{name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => addRange(wd)}
                      className="h-7 gap-1 px-2 text-xs"
                    >
                      <Plus className="size-3.5" />
                      {t('addRange')}
                    </Button>
                  </div>

                  {week[wd]!.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground/70">{t('noRanges')}</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {week[wd]!.map((range, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={range.start}
                            onChange={(e) => updateRange(wd, idx, 'start', e.target.value)}
                            aria-label={`${name} — ${t('start')}`}
                            className="h-9 flex-1 text-sm"
                            dir="ltr"
                          />
                          <span className="text-muted-foreground">–</span>
                          <Input
                            type="time"
                            value={range.end}
                            onChange={(e) => updateRange(wd, idx, 'end', e.target.value)}
                            aria-label={`${name} — ${t('end')}`}
                            className="h-9 flex-1 text-sm"
                            dir="ltr"
                          />
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            onClick={() => removeRange(wd, idx)}
                            aria-label={t('removeRange')}
                            className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ma-tz" className="text-xs">{t('timezoneLabel')}</Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger id="ma-tz" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TZ_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>

          {/* Blocked dates */}
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">{t('blockedTitle')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('blockedHint')}</p>
            </div>
            <AvailabilityCalendar
              month={calMonth}
              onMonthChange={setCalMonth}
              unavailableDates={blocked}
              selectedDate={null}
              onSelectDate={toggleBlocked}
              locale={locale}
              mode="block"
            />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarOff className="size-3.5" />
              {t('blockedCount', { count: blocked.length })}
            </p>
          </section>
        </div>

        {error && (
          <div
            role="alert"
            className={cn(
              'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive',
            )}
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button type="button" loading={saving} onClick={onSave}>
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
