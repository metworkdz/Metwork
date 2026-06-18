'use client';

/**
 * Availability editor — the consultant's Cal-style scheduling surface.
 * Unavailable by default; tap to open weekday time blocks. Sets minNoticeHours
 * and bufferMinutes. Blocked dates use the shared AvailabilityCalendar in
 * "block" mode. Saves via PATCH /api/consultant/availability.
 */
import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarClock, CalendarOff, Plus, Trash2 } from 'lucide-react';
import { AvailabilityCalendar } from '@/components/shared/availability-calendar';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantMentor } from '@/services/consultant.service';
import type { AvailabilityTimeRange } from '@/types/mentor';
import { cn } from '@/lib/utils';
import {
  BrandButton, CP_GREEN, EmptyBlock, ErrorBanner, Field, FlowSheet,
  SectionCard, SectionHeading, calLocale, cpInputClass,
} from './shared';

type WeeklyState = AvailabilityTimeRange[][]; // index 0..6 = Sun..Sat

const TZ_OPTIONS = ['Africa/Algiers', 'Europe/Paris', 'Europe/London', 'UTC'];
const NOTICE_OPTIONS = [24, 48];
const BUFFER_OPTIONS = [0, 15, 30];

function emptyWeek(): WeeklyState {
  return Array.from({ length: 7 }, () => []);
}

function weekFromMentor(m: ConsultantMentor): WeeklyState {
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
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function Segmented<T extends number>({ value, options, render, onChange }: {
  value: T; options: readonly T[]; render: (v: T) => string; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-1">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt} type="button" onClick={() => onChange(opt)}
            className={cn(
              'min-h-9 rounded-lg px-3 text-xs font-medium transition-colors',
              active ? 'text-[#04130b]' : 'text-white/60 hover:text-white',
            )}
            style={active ? { backgroundColor: CP_GREEN } : undefined}
          >
            {render(opt)}
          </button>
        );
      })}
    </div>
  );
}

export function AvailabilityEditor({ mentor, onSaved }: { mentor: ConsultantMentor; onSaved: (m: ConsultantMentor) => void }) {
  const t = useTranslations('consultantPortal.availability');
  const locale = calLocale(useLocale());

  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState<WeeklyState>(emptyWeek);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [timezone, setTimezone] = useState('Africa/Algiers');
  const [minNotice, setMinNotice] = useState<number>(24);
  const [buffer, setBuffer] = useState<number>(0);
  const [calMonth, setCalMonth] = useState<string>(currentMonth);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekdayNames = useMemo(() => {
    const tag = locale === 'fr' ? 'fr-FR' : locale === 'ar' ? 'ar-DZ' : 'en-US';
    const fmt = new Intl.DateTimeFormat(tag, { weekday: 'long' });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2023, 0, 1 + i))));
  }, [locale]);

  const openDayCount = (mentor.weeklyAvailability ?? []).filter((d) => d.slots.length > 0).length;

  function hydrate() {
    setWeek(weekFromMentor(mentor));
    setBlocked([...(mentor.blockedDates ?? [])]);
    setTimezone(mentor.availabilityTimezone || 'Africa/Algiers');
    setMinNotice(mentor.minNoticeHours ?? 24);
    setBuffer(mentor.bufferMinutes ?? 0);
    setCalMonth(currentMonth());
    setError(null);
  }

  function addRange(wd: number) {
    setWeek((w) => { const n = w.map((r) => [...r]); n[wd]!.push({ start: '09:00', end: '17:00' }); return n; });
  }
  function removeRange(wd: number, idx: number) {
    setWeek((w) => { const n = w.map((r) => [...r]); n[wd]!.splice(idx, 1); return n; });
  }
  function updateRange(wd: number, idx: number, key: 'start' | 'end', value: string) {
    setWeek((w) => { const n = w.map((r) => r.map((s) => ({ ...s }))); n[wd]![idx]![key] = value; return n; });
  }
  function toggleBlocked(date: string) {
    setBlocked((b) => (b.includes(date) ? b.filter((d) => d !== date) : [...b, date]));
  }

  function validate(): string | null {
    for (let wd = 0; wd < 7; wd++) {
      const intervals: Array<{ start: number; end: number }> = [];
      for (const r of week[wd]!) {
        const start = toMin(r.start); const end = toMin(r.end);
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

  async function save() {
    const err = validate();
    if (err) { setError(err); return; }
    setSaving(true); setError(null);
    try {
      const weeklyAvailability = week
        .map((slots, weekday) => ({ weekday, slots }))
        .filter((d) => d.slots.length > 0);
      const { mentor: saved } = await consultantService.updateAvailability({
        weeklyAvailability,
        blockedDates: blocked,
        availabilityTimezone: timezone,
        minNoticeHours: minNotice,
        bufferMinutes: buffer,
      });
      onSaved(saved);
      setOpen(false);
    } catch (e) {
      setError(e instanceof ApiClientError ? (e.message || t('saveFailed')) : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <SectionHeading
        title={t('heading')}
        subtitle={t('subtitle')}
        action={
          <BrandButton onClick={() => { hydrate(); setOpen(true); }} className="px-3 text-xs">
            <CalendarClock className="size-4" /> {t('editCta')}
          </BrandButton>
        }
      />
      <SectionCard>
        {openDayCount === 0 ? (
          <EmptyBlock>{t('noneSet')}</EmptyBlock>
        ) : (
          <p className="flex items-center gap-2 text-sm text-white/70">
            <CalendarClock className="size-4" style={{ color: CP_GREEN }} />
            {t('openDays', { count: openDayCount })}
            {(mentor.blockedDates?.length ?? 0) > 0 && (
              <span className="text-white/40">· {t('blockedCount', { count: mentor.blockedDates!.length })}</span>
            )}
          </p>
        )}
      </SectionCard>

      <FlowSheet
        open={open}
        onOpenChange={setOpen}
        title={t('heading')}
        footer={
          <div className="flex justify-end">
            <BrandButton onClick={save} loading={saving} className="px-5">{t('save')}</BrandButton>
          </div>
        }
      >
        <div className="space-y-6">
          {/* Weekly template */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">{t('weeklyTitle')}</p>
            <p className="text-xs text-white/45">{t('weeklyHint')}</p>
            {weekdayNames.map((name, wd) => (
              <div key={wd} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium capitalize text-white">{name}</span>
                  <button
                    type="button" onClick={() => addRange(wd)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs text-white/70 hover:text-white"
                  >
                    <Plus className="size-3.5" /> {t('addRange')}
                  </button>
                </div>
                {week[wd]!.length === 0 ? (
                  <p className="mt-2 text-xs text-white/35">{t('noRanges')}</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {week[wd]!.map((range, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="time" value={range.start} dir="ltr"
                          onChange={(e) => updateRange(wd, idx, 'start', e.target.value)}
                          aria-label={`${name} — ${t('start')}`} className={`${cpInputClass} h-9 flex-1`}
                        />
                        <span className="text-white/40">–</span>
                        <input
                          type="time" value={range.end} dir="ltr"
                          onChange={(e) => updateRange(wd, idx, 'end', e.target.value)}
                          aria-label={`${name} — ${t('end')}`} className={`${cpInputClass} h-9 flex-1`}
                        />
                        <button
                          type="button" onClick={() => removeRange(wd, idx)} aria-label={t('removeRange')}
                          className="grid size-9 shrink-0 place-items-center rounded-lg text-white/50 hover:text-red-400"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Booking rules */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-white">{t('policyTitle')}</p>
            <Field label={t('minNoticeLabel')}>
              <div>
                <Segmented
                  value={NOTICE_OPTIONS.includes(minNotice) ? minNotice : 24}
                  options={NOTICE_OPTIONS}
                  render={(v) => (v === 24 ? t('minNotice24') : t('minNotice48'))}
                  onChange={setMinNotice}
                />
              </div>
            </Field>
            <Field label={t('bufferLabel')}>
              <div>
                <Segmented
                  value={BUFFER_OPTIONS.includes(buffer) ? buffer : 0}
                  options={BUFFER_OPTIONS}
                  render={(v) => (v === 0 ? t('bufferNone') : t('bufferMinutes', { count: v }))}
                  onChange={setBuffer}
                />
              </div>
            </Field>
            <Field label={t('timezoneLabel')} htmlFor="cp-tz">
              <select
                id="cp-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}
                className={cpInputClass} dir="ltr"
              >
                {TZ_OPTIONS.map((tz) => <option key={tz} value={tz} className="bg-[#101010]">{tz}</option>)}
              </select>
            </Field>
          </div>

          {/* Blocked dates */}
          <div className="space-y-2">
            <p className="text-sm font-semibold text-white">{t('blockedTitle')}</p>
            <p className="text-xs text-white/45">{t('blockedHint')}</p>
            <AvailabilityCalendar
              month={calMonth}
              onMonthChange={setCalMonth}
              unavailableDates={blocked}
              selectedDate={null}
              onSelectDate={toggleBlocked}
              locale={locale}
              mode="block"
            />
            <p className="flex items-center gap-1.5 text-xs text-white/45">
              <CalendarOff className="size-3.5" /> {t('blockedCount', { count: blocked.length })}
            </p>
          </div>

          {error && <ErrorBanner message={error} />}
        </div>
      </FlowSheet>
    </section>
  );
}
