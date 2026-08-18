'use client';

/**
 * Spaces — reserve a room for an in-person consultation.
 *
 * The consultant browses cash-accepting spaces, picks a slot, and reserves.
 * NO money moves on Metwork: the reservation lands PENDING_PAYMENT and the
 * consultant settles with the space directly on site (or just calls them).
 * That is why there is no card/wallet step anywhere in this flow.
 *
 * Availability is always read from the canonical
 * `GET /api/spaces/:id/availability` feed — the same aggregation the booking
 * write gate is built on — so this UI can never offer a slot the server would
 * reject. The server re-validates everything at write time regardless; nothing
 * here is trusted.
 *
 * Layout is mobile-first with Tailwind breakpoints only (no useMediaQuery /
 * window.innerWidth), so it renders identically on server and client.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Building2, CalendarDays, Check, MapPin, Phone, Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ApiClientError } from '@/lib/api-client';
import { safeUUID } from '@/lib/safe-uuid';
import { cn } from '@/lib/utils';
import {
  consultantService,
  type ConsultantSpace,
  type ConsultantSpaceBooking,
  type SpaceAvailabilityResponse,
} from '@/services/consultant.service';
import type { SpaceCategory } from '@/types/domain';
import {
  BrandButton, CP_GREEN_TEXT, CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED, CP_LIGHT_TEXT,
  EmptyBlock, ErrorBanner, Field, FlowSheet, SectionCard, SectionHeading, Spinner,
  cpInputClassLight, fmtDZD,
} from './shared';

type Unit = 'HOUR' | 'HALF_DAY' | 'DAY' | 'MONTH';
type Tab = 'browse' | 'mine';
/** DOMICILIATION is an address service, not a bookable room — never offered here. */
const CATEGORIES: SpaceCategory[] = ['COWORKING', 'PRIVATE_OFFICE', 'TRAINING_ROOM'];

const STATUS_VARIANT: Record<string, 'warning' | 'success' | 'danger' | 'info' | 'primary'> = {
  PENDING_PAYMENT: 'warning', PENDING: 'warning', AWAITING_APPROVAL: 'info',
  CONFIRMED: 'success', COMPLETED: 'primary', CANCELLED: 'danger', REFUNDED: 'danger',
};

/** "YYYY-MM-DD" for today, local time. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Build the booking instant for a date + "HH:MM".
 *
 * The platform treats a picked wall-clock time AS UTC (`space-booking-form`
 * does the same, and the server reads it back with `isoToUtcMinutes` when
 * validating working hours). Parsing as local time instead would shift the
 * slot by the viewer's offset and get it rejected as OUTSIDE_WORKING_HOURS.
 */
function atTime(dateStr: string, hhmm: string): string {
  return `${dateStr}T${hhmm}:00.000Z`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function minutesToHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Server-matching unit price. `createSpaceBooking` prices a cash reservation
 * from the BASE `pricePer*` (its `unitPrice` call uses the default
 * ONLINE_FULL mode), so the preview must read the same field — using
 * `cashPricePer*` here would show a total the server never charges.
 */
function unitPriceOf(space: ConsultantSpace, unit: Unit): number | null {
  if (unit === 'HOUR') return space.pricePerHour;
  if (unit === 'HALF_DAY') return space.pricePerHalfDay ?? null;
  if (unit === 'DAY') return space.pricePerDay;
  return space.pricePerMonth;
}

function availableUnitsOf(space: ConsultantSpace): Unit[] {
  return (['HOUR', 'HALF_DAY', 'DAY', 'MONTH'] as Unit[]).filter((u) => unitPriceOf(space, u) != null);
}

export function SpacesSection() {
  const t = useTranslations('consultantPortal.spaces');
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>('browse');

  const [spaces, setSpaces] = useState<ConsultantSpace[] | null>(null);
  const [cities, setCities] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [city, setCity] = useState('');
  const [category, setCategory] = useState<SpaceCategory | 'all'>('all');
  const [selected, setSelected] = useState<ConsultantSpace | null>(null);

  const [mine, setMine] = useState<ConsultantSpaceBooking[] | null>(null);

  const loadSpaces = useCallback(async () => {
    try {
      setFailed(false);
      const res = await consultantService.spaces();
      setSpaces(res.spaces);
      setCities(res.cities);
    } catch { setSpaces([]); setFailed(true); }
  }, []);

  const loadMine = useCallback(async () => {
    try { setMine((await consultantService.spaceBookings()).items); }
    catch { setMine([]); }
  }, []);

  useEffect(() => { void loadSpaces(); void loadMine(); }, [loadSpaces, loadMine]);

  const filtered = useMemo(() => {
    if (!spaces) return [];
    return spaces.filter(
      (s) =>
        (category === 'all' || s.category === category) &&
        (city === '' || s.city === city) &&
        s.category !== 'DOMICILIATION',
    );
  }, [spaces, category, city]);

  const fmtRange = (startsAt: string, endsAt: string) => {
    try {
      const s = new Date(startsAt);
      const e = new Date(endsAt);
      const d = s.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      const st = s.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const et = e.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      return `${d} · ${st} – ${et}`;
    } catch { return startsAt; }
  };

  return (
    <div className="space-y-4">
      <SectionHeading title={t('title')} subtitle={t('subtitle')} />

      {/* View switch */}
      <div className="flex gap-2 overflow-x-auto px-1 pb-1">
        {([['browse', t('tabBrowse')], ['mine', t('tabMine')]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === key ? 'text-white' : 'bg-white',
            )}
            style={tab === key
              ? { backgroundColor: CP_GREEN_TEXT, borderColor: CP_GREEN_TEXT }
              : { borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_MUTED }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'browse' ? (
        <>
          {/* Filters */}
          <SectionCard className="space-y-3">
            <Field label={t('filterCity')} htmlFor="sp-city">
              <select
                id="sp-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className={cpInputClassLight}
              >
                <option value="">{t('allCities')}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap gap-2">
              {(['all', ...CATEGORIES] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c as SpaceCategory | 'all')}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    category === c ? 'text-white' : 'bg-white',
                  )}
                  style={category === c
                    ? { backgroundColor: CP_GREEN_TEXT, borderColor: CP_GREEN_TEXT }
                    : { borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_MUTED }}
                >
                  {c === 'all' ? t('allCategories') : t(`category${c}` as 'categoryCOWORKING')}
                </button>
              ))}
            </div>
          </SectionCard>

          {failed && <ErrorBanner message={t('loadFailed')} tone="light" />}

          {spaces === null ? (
            <Spinner tone="light" />
          ) : filtered.length === 0 ? (
            <EmptyBlock>{t('empty')}</EmptyBlock>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((s) => (
                <SpaceRow key={s.id} space={s} onSelect={() => setSelected(s)} label={t} />
              ))}
            </div>
          )}
        </>
      ) : mine === null ? (
        <Spinner tone="light" />
      ) : mine.length === 0 ? (
        <EmptyBlock>{t('noReservations')}</EmptyBlock>
      ) : (
        <SectionCard className="space-y-1">
          {mine.map((b) => (
            <div key={b.id} className="flex items-start gap-3 rounded-2xl px-1 py-2.5">
              <span
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: '#F7F8F9', color: CP_GREEN_TEXT }}
              >
                <Building2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{b.itemName}</p>
                <p className="mt-0.5 truncate text-xs" style={{ color: CP_LIGHT_MUTED }}>
                  {b.vendorName} · {b.city}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: CP_LIGHT_FAINT }}>{fmtRange(b.startsAt, b.endsAt)}</p>
              </div>
              <div className="shrink-0 text-end">
                <Badge variant={STATUS_VARIANT[b.status] ?? 'info'}>{t(`status${b.status}` as 'statusPENDING_PAYMENT')}</Badge>
                <p className="mt-1 text-xs font-semibold tabular-nums" style={{ color: CP_LIGHT_TEXT }}>
                  {fmtDZD(b.totalAmount)}
                </p>
              </div>
            </div>
          ))}
        </SectionCard>
      )}

      <ReserveSheet
        space={selected}
        onClose={() => setSelected(null)}
        onDone={() => { setSelected(null); setTab('mine'); void loadMine(); }}
      />
    </div>
  );
}

/* ─────────────────────────── Space row ─────────────────────────── */

function SpaceRow({
  space, onSelect, label,
}: { space: ConsultantSpace; onSelect: () => void; label: ReturnType<typeof useTranslations> }) {
  const units = availableUnitsOf(space);
  const from = units.length
    ? Math.min(...units.map((u) => unitPriceOf(space, u) ?? Number.POSITIVE_INFINITY))
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col gap-2 rounded-3xl border bg-white p-3 text-start transition-colors hover:bg-[#F7F8F9] active:bg-[#F0F1F2]"
      style={{ borderColor: CP_LIGHT_BORDER }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: '#F7F8F9', color: CP_GREEN_TEXT }}
        >
          <Building2 className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: CP_LIGHT_TEXT }}>{space.name}</p>
          <p className="mt-0.5 truncate text-xs" style={{ color: CP_LIGHT_MUTED }}>{space.incubatorName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: CP_LIGHT_FAINT }}>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{space.city}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{space.capacity}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Badge variant="info">{label(`category${space.category}` as 'categoryCOWORKING')}</Badge>
        {from != null && Number.isFinite(from) && (
          <span className="text-xs font-semibold tabular-nums" style={{ color: CP_LIGHT_TEXT }}>
            {label('fromPrice', { price: fmtDZD(from) })}
          </span>
        )}
      </div>
    </button>
  );
}

/* ─────────────────────────── Reserve sheet ─────────────────────────── */

function ReserveSheet({
  space, onClose, onDone,
}: { space: ConsultantSpace | null; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('consultantPortal.spaces');
  const [unit, setUnit] = useState<Unit>('HOUR');
  const [date, setDate] = useState(todayStr());
  const [startTime, setStartTime] = useState('09:00');
  const [qty, setQty] = useState(1);
  const [deskName, setDeskName] = useState('');
  const [avail, setAvail] = useState<SpaceAvailabilityResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const units = space ? availableUnitsOf(space) : [];

  // Reset the form whenever a different space is opened.
  useEffect(() => {
    if (!space) return;
    const us = availableUnitsOf(space);
    setUnit(us[0] ?? 'HOUR');
    setDate(todayStr());
    setStartTime(space.openingTime || '09:00');
    setQty(1);
    setDeskName('');
    setError(null);
    setDone(false);
    setAvail(null);
  }, [space]);

  // Canonical availability for the chosen day — the same feed the write gate uses.
  useEffect(() => {
    if (!space || !date) return;
    let cancelled = false;
    (async () => {
      try {
        const from = `${date}T00:00:00.000Z`;
        const to = `${date}T23:59:59.999Z`;
        const res = await consultantService.spaceAvailability(space.id, from, to);
        if (!cancelled) setAvail(res);
      } catch { if (!cancelled) setAvail(null); }
    })();
    return () => { cancelled = true; };
  }, [space, date]);

  const { startsAt, endsAt } = useMemo(() => {
    if (!space) return { startsAt: '', endsAt: '' };
    if (unit === 'HOUR') {
      const s = atTime(date, startTime);
      const e = new Date(new Date(s).getTime() + qty * 3_600_000).toISOString();
      return { startsAt: s, endsAt: e };
    }
    if (unit === 'HALF_DAY') {
      const s = atTime(date, space.halfDayStart || space.openingTime || '09:00');
      const e = atTime(date, space.halfDayEnd || '13:00');
      return { startsAt: s, endsAt: e };
    }
    const s = atTime(date, space.openingTime || '09:00');
    const days = unit === 'DAY' ? qty : qty * 30;
    const e = new Date(new Date(s).getTime() + days * 86_400_000).toISOString();
    return { startsAt: s, endsAt: e };
  }, [space, unit, date, startTime, qty]);

  /** Hour options inside working hours, minus anything the canonical feed blocks. */
  const hourOptions = useMemo(() => {
    if (!space) return [];
    const open = hhmmToMinutes(space.openingTime || '09:00');
    const close = hhmmToMinutes(space.closingTime || '18:00');
    const blocked = (avail?.intervals ?? []).map((i) => ({
      start: new Date(i.start).getTime(),
      end: new Date(i.end).getTime(),
      allDay: i.allDay,
    }));
    const out: { value: string; disabled: boolean }[] = [];
    for (let m = open; m + 60 <= close; m += 60) {
      const hhmm = minutesToHHMM(m);
      const s = new Date(atTime(date, hhmm)).getTime();
      const e = s + 3_600_000;
      const clash = blocked.some((b) => b.allDay || (s < b.end && e > b.start));
      out.push({ value: hhmm, disabled: clash });
    }
    return out;
  }, [space, avail, date]);

  const dayFullyBlocked = (avail?.intervals ?? []).some((i) => i.allDay);
  const price = space ? unitPriceOf(space, unit) : null;
  const total = price != null ? price * (unit === 'HALF_DAY' ? 1 : qty) : null;

  const isWorkingDay = useMemo(() => {
    if (!space || !date) return true;
    const dow = new Date(`${date}T12:00:00.000Z`).getUTCDay();
    const days = space.workingDays?.length ? space.workingDays : [1, 2, 3, 4, 5];
    return days.includes(dow);
  }, [space, date]);

  async function submit() {
    if (!space) return;
    setSaving(true);
    setError(null);
    try {
      await consultantService.createSpaceBooking({
        spaceId: space.id,
        unit,
        startsAt,
        endsAt,
        // Fresh key per submit attempt; a network retry of the SAME attempt
        // replays server-side instead of creating a second reservation.
        clientReference: safeUUID(),
        deskName: deskName.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : null;
      const known = [
        'CASH_NOT_ACCEPTED', 'DATE_UNAVAILABLE', 'CAPACITY_EXCEEDED', 'OVERLAP_CONFLICT',
        'OUTSIDE_WORKING_HOURS', 'NOT_A_WORKING_DAY', 'UNIT_NOT_AVAILABLE', 'RATE_LIMITED',
      ];
      setError(code && known.includes(code) ? t(`err${code}` as 'errOVERLAP_CONFLICT') : t('errGeneric'));
    } finally { setSaving(false); }
  }

  const blocked = dayFullyBlocked || !isWorkingDay;

  return (
    <FlowSheet
      open={space !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={done ? t('reservedTitle') : space?.name ?? ''}
      footer={
        done ? (
          <BrandButton tone="light" className="w-full" onClick={onDone}>{t('viewReservations')}</BrandButton>
        ) : (
          <BrandButton
            tone="light"
            className="w-full"
            loading={saving}
            disabled={blocked || total == null}
            onClick={() => void submit()}
          >
            {t('reserveCta')}
          </BrandButton>
        )
      }
    >
      {!space ? null : done ? (
        <div className="space-y-3 py-2 text-center">
          <span
            className="mx-auto flex size-14 items-center justify-center rounded-full"
            style={{ background: '#E6F5EA', color: CP_GREEN_TEXT }}
          >
            <Check className="size-7" />
          </span>
          <p className="text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{t('reservedBody')}</p>
          <p className="text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>{t('reservedPayOnSite')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Pay-on-site notice — the whole point of this flow. */}
          <div
            className="rounded-2xl border px-3 py-2.5 text-xs leading-relaxed"
            style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9', color: CP_LIGHT_MUTED }}
          >
            {t('payOnSiteNotice')}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: CP_LIGHT_FAINT }}>
            <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{space.city}</span>
            <span className="inline-flex items-center gap-1"><Users className="size-3" />{space.capacity}</span>
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />{space.openingTime}–{space.closingTime}</span>
          </div>

          {units.length > 1 && (
            <Field label={t('unitLabel')}>
              <div className="flex flex-wrap gap-2">
                {units.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => { setUnit(u); setQty(1); }}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      unit === u ? 'text-white' : 'bg-white',
                    )}
                    style={unit === u
                      ? { backgroundColor: CP_GREEN_TEXT, borderColor: CP_GREEN_TEXT }
                      : { borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_MUTED }}
                  >
                    {t(`unit${u}` as 'unitHOUR')}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <Field label={t('dateLabel')} htmlFor="sp-date">
            <input
              id="sp-date"
              type="date"
              min={todayStr()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={cpInputClassLight}
            />
          </Field>

          {unit === 'HOUR' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('startLabel')} htmlFor="sp-start">
                <select
                  id="sp-start"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={cpInputClassLight}
                >
                  {hourOptions.map((h) => (
                    <option key={h.value} value={h.value} disabled={h.disabled}>
                      {h.value}{h.disabled ? ` — ${t('taken')}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('hoursLabel')} htmlFor="sp-qty">
                <input
                  id="sp-qty" type="number" min={1} max={12} value={qty}
                  onChange={(e) => setQty(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                  className={cpInputClassLight}
                />
              </Field>
            </div>
          )}

          {(unit === 'DAY' || unit === 'MONTH') && (
            <Field label={t(unit === 'DAY' ? 'daysLabel' : 'monthsLabel')} htmlFor="sp-qty2">
              <input
                id="sp-qty2" type="number" min={1} max={unit === 'DAY' ? 30 : 12} value={qty}
                onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                className={cpInputClassLight}
              />
            </Field>
          )}

          {space.category === 'COWORKING' && (space.deskNames?.length ?? 0) > 0 && (
            <Field label={t('deskLabel')} htmlFor="sp-desk">
              <select id="sp-desk" value={deskName} onChange={(e) => setDeskName(e.target.value)} className={cpInputClassLight}>
                <option value="">{t('anyDesk')}</option>
                {(space.deskNames ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          )}

          {!isWorkingDay && <ErrorBanner message={t('errNOT_A_WORKING_DAY')} tone="light" />}
          {dayFullyBlocked && <ErrorBanner message={t('errDATE_UNAVAILABLE')} tone="light" />}
          {error && <ErrorBanner message={error} tone="light" />}

          {total != null && !blocked && (
            <div
              className="flex items-center justify-between rounded-2xl px-3 py-3"
              style={{ background: '#F7F8F9' }}
            >
              <span className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{t('totalOnSite')}</span>
              <span className="text-base font-bold tabular-nums" style={{ color: CP_LIGHT_TEXT }}>{fmtDZD(total)}</span>
            </div>
          )}

          {/* Contact-the-space escape hatch — reserving is optional. */}
          {space.contactPhone && (
            <a
              href={`tel:${space.contactPhone}`}
              className="flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium"
              style={{ borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_TEXT }}
            >
              <Phone className="size-4" />{t('callSpace')}
            </a>
          )}
        </div>
      )}
    </FlowSheet>
  );
}
