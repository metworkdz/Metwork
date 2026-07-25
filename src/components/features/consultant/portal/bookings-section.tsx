'use client';

/**
 * Booked consultations — filter tabs + list + push/pop detail sheet. The
 * detail reveals the client's contact PII (rendered only to a valid PIN/device
 * session, which is what authenticates every /api/consultant call). From the
 * detail the consultant can add a meeting link / confirm in-person
 * (AWAITING_LINK → READY, which fires the client notification), mark
 * completed, reschedule, or cancel.
 *
 * The Upcoming/Pending/Past/All tabs are a client-side grouping of the single
 * fetched list — no extra request, no server-side filtering.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Calendar, CheckCircle2, ChevronLeft, Clock, LinkIcon, Mail, MapPin, Phone, Video, XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { MentorScheduler } from '@/components/features/mentors/mentor-scheduler';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantBooking } from '@/services/consultant.service';
import type { DaySlot } from '@/types/mentor';
import { cn } from '@/lib/utils';
import {
  Avatar, BrandButton, CP_GREEN, CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED, EmptyBlock, ErrorBanner, Field,
  FlowSheet, RowButton, SectionCard, SectionHeading, Spinner, calLocale, cpInputClassLight, fmtDZD,
} from './shared';

type BadgeVariant = 'warning' | 'success' | 'danger' | 'info' | 'primary';
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  PENDING_PAYMENT: 'warning', AWAITING_LINK: 'info', READY: 'success',
  COMPLETED: 'primary', CANCELLED: 'danger',
};

type View = 'detail' | 'link' | 'reschedule' | 'cancel';
type FilterKey = 'upcoming' | 'pending' | 'past' | 'all';

function matchesFilter(status: string, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  if (filter === 'upcoming') return status === 'READY' || status === 'AWAITING_LINK';
  if (filter === 'pending') return status === 'PENDING_PAYMENT';
  return status === 'COMPLETED' || status === 'CANCELLED'; // past
}

export function BookingsSection({ mentorId }: { mentorId: string }) {
  const t = useTranslations('consultantPortal.bookings');
  const tStatus = useTranslations('admin.mentorBookings');
  const [items, setItems] = useState<ConsultantBooking[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ConsultantBooking | null>(null);
  const [filter, setFilter] = useState<FilterKey>('upcoming');

  const load = useCallback(async () => {
    try { setFailed(false); setItems((await consultantService.bookings()).items); }
    catch { setItems([]); setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const statusLabel = (s: string) => ({
    PENDING_PAYMENT: tStatus('statusPendingPayment'), AWAITING_LINK: tStatus('statusAwaitingLink'),
    READY: tStatus('statusReady'), COMPLETED: tStatus('statusCompleted'), CANCELLED: tStatus('statusCancelled'),
  } as Record<string, string>)[s] ?? s;

  const filters: Array<{ key: FilterKey; label: string }> = [
    { key: 'upcoming', label: t('upcoming') },
    { key: 'pending', label: t('pending') },
    { key: 'past', label: t('past') },
    { key: 'all', label: t('all') },
  ];

  const filtered = useMemo(
    () => (items ?? []).filter((b) => matchesFilter(b.status, filter)),
    [items, filter],
  );

  return (
    <section>
      <SectionHeading title={t('heading')} />

      <div className="mb-4 flex gap-1.5 overflow-x-auto rounded-xl p-1" style={{ background: '#F0F1F2' }}>
        {filters.map(({ key, label }) => {
          const active = filter === key;
          return (
            <button
              key={key} type="button" onClick={() => setFilter(key)}
              className={cn(
                'shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-xs font-medium transition-colors',
                active ? 'font-semibold text-white' : 'text-[#5A615E] hover:text-[#0D0D0D]',
              )}
              style={active ? { background: '#0D0D0D' } : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      <SectionCard className="space-y-2 p-2">
        {items === null ? (
          <Spinner tone="light" />
        ) : failed ? (
          <div className="p-3"><ErrorBanner tone="light" message={t('loadFailed')} /></div>
        ) : filtered.length === 0 ? (
          <div className="p-2"><EmptyBlock>{t('empty')}</EmptyBlock></div>
        ) : (
          filtered.map((b) => (
            <RowButton
              key={b.id}
              onClick={() => setSelected(b)}
              leading={<Avatar name={b.userName} size={42} />}
              title={b.userName}
              subtitle={
                <span className="inline-flex items-center gap-2">
                  {b.scheduledAt && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />{new Date(b.scheduledAt).toLocaleDateString()}
                    </span>
                  )}
                  {b.durationMinutes ? <span>· {b.durationMinutes} min</span> : null}
                </span>
              }
              trailing={
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={STATUS_VARIANT[b.status] ?? 'info'}>{statusLabel(b.status)}</Badge>
                  <span className="text-xs tabular-nums" style={{ color: CP_LIGHT_MUTED }}>{fmtDZD(b.amountCharged)}</span>
                </div>
              }
            />
          ))
        )}
      </SectionCard>

      {selected && (
        <BookingDetail
          booking={selected}
          mentorId={mentorId}
          statusLabel={statusLabel(selected.status)}
          onClose={() => setSelected(null)}
          onChanged={async () => { await load(); }}
        />
      )}
    </section>
  );
}

function BookingDetail({
  booking, mentorId, statusLabel, onClose, onChanged,
}: {
  booking: ConsultantBooking;
  mentorId: string;
  statusLabel: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations('consultantPortal.bookings');
  const locale = calLocale(useLocale());

  const [view, setView] = useState<View>('detail');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-link / confirm-offline.
  const [mode, setMode] = useState<'ONLINE' | 'OFFLINE'>('ONLINE');
  const [link, setLink] = useState('');
  const [address, setAddress] = useState('');
  const [mapsLink, setMapsLink] = useState('');
  // Reschedule.
  const [resDate, setResDate] = useState<string | null>(null);
  const [resTime, setResTime] = useState<string | null>(null);
  // Cancel.
  const [cancelReason, setCancelReason] = useState('');

  const isManageable = booking.status === 'READY' || booking.status === 'AWAITING_LINK';
  const canCancel = isManageable && booking.source !== 'guest';

  const fail = (e: unknown) => setError(e instanceof ApiClientError ? (e.message || t('loadFailed')) : t('loadFailed'));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await onChanged(); onClose(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  const saveLink = () => run(() =>
    consultantService.setBookingLink(booking.id, {
      mode,
      link: mode === 'ONLINE' ? link.trim() : null,
      address: mode === 'OFFLINE' ? address.trim() : null,
      mapsLink: mode === 'OFFLINE' ? (mapsLink.trim() || null) : null,
    }));
  const complete = () => run(() => consultantService.completeBooking(booking.id));
  const submitReschedule = () => {
    if (!resDate || !resTime) return;
    return run(() => consultantService.rescheduleBooking(booking.id, { date: resDate, time: resTime }));
  };
  const submitCancel = () => run(() =>
    consultantService.cancelBooking(booking.id, cancelReason.trim() ? { reason: cancelReason.trim() } : undefined));

  const title = view === 'link' ? t('addLinkHeading')
    : view === 'reschedule' ? t('rescheduleTitle')
    : view === 'cancel' ? t('cancelTitle')
    : t('detailHeading');

  const back = (
    <button type="button" onClick={() => { setView('detail'); setError(null); }}
      className="inline-flex items-center gap-1 text-xs text-[#5A615E] hover:text-[#0D0D0D]">
      <ChevronLeft className="size-4" /> {t('close')}
    </button>
  );

  return (
    <FlowSheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
      footer={
        view === 'detail' && isManageable ? (
          <div className="flex flex-wrap gap-2">
            {booking.status === 'AWAITING_LINK' && (
              <BrandButton tone="light" onClick={() => { setView('link'); setError(null); }} className="flex-1">
                <LinkIcon className="size-4" /> {t('addLinkHeading')}
              </BrandButton>
            )}
            {booking.status === 'READY' && (
              <BrandButton tone="light" onClick={complete} loading={busy} className="flex-1">
                <CheckCircle2 className="size-4" /> {t('completeCta')}
              </BrandButton>
            )}
          </div>
        ) : view === 'link' ? (
          <div className="flex justify-end">
            <BrandButton
              tone="light"
              onClick={saveLink}
              loading={busy}
              disabled={mode === 'ONLINE' ? link.trim().length < 4 : address.trim().length < 3}
            >
              {mode === 'ONLINE' ? t('setLinkCta') : t('confirmOfflineCta')}
            </BrandButton>
          </div>
        ) : view === 'reschedule' ? (
          <div className="flex justify-end">
            <BrandButton tone="light" onClick={submitReschedule} loading={busy} disabled={!resDate || !resTime}>
              {t('rescheduleConfirm')}
            </BrandButton>
          </div>
        ) : view === 'cancel' ? (
          <button
            type="button" onClick={submitCancel} disabled={busy}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {t('cancelConfirm')}
          </button>
        ) : undefined
      }
    >
      {view === 'detail' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <Badge variant={(STATUS_VARIANT[booking.status] ?? 'info')}>{statusLabel}</Badge>
            <span className="text-lg font-semibold tabular-nums text-[#0D0D0D]">{fmtDZD(booking.amountCharged)}</span>
          </div>

          {/* Session facts */}
          <div className="grid grid-cols-2 gap-2">
            {booking.scheduledAt && (
              <Fact icon={<Calendar className="size-4" />} value={new Date(booking.scheduledAt).toLocaleString()} />
            )}
            {booking.durationMinutes && (
              <Fact icon={<Clock className="size-4" />} value={`${booking.durationMinutes} min`} />
            )}
            {booking.meetingMode === 'ONLINE' && (
              <Fact icon={<Video className="size-4" />} value={t('online')} />
            )}
            {booking.meetingMode === 'OFFLINE' && (
              <Fact icon={<MapPin className="size-4" />} value={t('inPerson')} />
            )}
          </div>

          {/* Auto-generated Zoom meeting — read-only until replaced manually */}
          {booking.meetingMode === 'ONLINE' && booking.meetingSource === 'auto' && (
            <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: CP_LIGHT_MUTED }}>{t('autoGeneratedLabel')}</p>
                <Badge variant="success" className="text-[10px]">{t('zoomBadge')}</Badge>
              </div>
              {booking.meetingLink && (
                <a href={booking.meetingLink} target="_blank" rel="noopener noreferrer" dir="ltr"
                  className="block truncate text-xs underline" style={{ color: CP_GREEN }}>
                  {booking.meetingLink}
                </a>
              )}
              {booking.zoomStartUrl && (
                <a href={booking.zoomStartUrl} target="_blank" rel="noopener noreferrer" dir="ltr"
                  className="inline-flex items-center gap-1.5 text-xs font-medium underline" style={{ color: CP_GREEN }}>
                  <Video className="size-3.5" /> {t('startAsHostCta')}
                </a>
              )}
            </div>
          )}

          {/* In-person address (delivered to the client) */}
          {booking.meetingMode === 'OFFLINE' && booking.meetingAddress && (
            <div className="space-y-1 rounded-xl border p-3" style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
              <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: CP_LIGHT_MUTED }}>{t('addressLabel')}</p>
              <p className="text-sm text-[#0D0D0D]">{booking.meetingAddress}</p>
              {booking.meetingMapsLink && (
                <a href={booking.meetingMapsLink} target="_blank" rel="noopener noreferrer"
                  dir="ltr" className="inline-block text-xs underline" style={{ color: CP_GREEN }}>
                  Google Maps
                </a>
              )}
            </div>
          )}

          {/* Client PII */}
          <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: CP_LIGHT_MUTED }}>{t('clientHeading')}</p>
            <p className="text-sm font-medium text-[#0D0D0D]">{booking.userName}</p>
            <Contact icon={<Phone className="size-3.5" />} label={t('phoneLabel')} value={booking.userPhone} dir="ltr" />
            <Contact icon={<Mail className="size-3.5" />} label={t('emailLabel')} value={booking.userEmail} dir="ltr" />
            {booking.message && (
              <div className="pt-1">
                <p className="text-[11px] font-medium" style={{ color: CP_LIGHT_MUTED }}>{t('projectLabel')}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-[#2A2F2C]">{booking.message}</p>
              </div>
            )}
          </div>

          {(booking.rescheduleCount ?? 0) > 0 && (
            <p className="text-xs" style={{ color: CP_LIGHT_FAINT }}>{t('rescheduledTimes', { count: booking.rescheduleCount ?? 0 })}</p>
          )}

          {/* Secondary actions */}
          {isManageable && (
            <div className="flex flex-wrap gap-2 border-t pt-3" style={{ borderColor: CP_LIGHT_BORDER }}>
              {booking.status === 'READY' && booking.meetingMode === 'ONLINE' && booking.meetingSource === 'auto' && (
                <SecondaryBtn onClick={() => { setMode('ONLINE'); setLink(''); setView('link'); setError(null); }}>
                  <LinkIcon className="size-3.5" /> {t('replaceManuallyCta')}
                </SecondaryBtn>
              )}
              <SecondaryBtn onClick={() => { setResDate(null); setResTime(null); setView('reschedule'); setError(null); }}>
                {t('rescheduleCta')}
              </SecondaryBtn>
              {canCancel && (
                <SecondaryBtn danger onClick={() => { setCancelReason(''); setView('cancel'); setError(null); }}>
                  <XCircle className="size-3.5" /> {t('cancelCta')}
                </SecondaryBtn>
              )}
            </div>
          )}
          {error && <ErrorBanner tone="light" message={error} />}
        </div>
      )}

      {view === 'link' && (
        <div className="space-y-4">
          {back}
          <div className="inline-flex rounded-xl border p-1" style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
            {(['ONLINE', 'OFFLINE'] as const).map((m) => (
              <button
                key={m} type="button" onClick={() => setMode(m)}
                className={cn('min-h-9 rounded-lg px-4 text-xs font-medium transition-colors',
                  mode === m ? 'text-white' : 'text-[#5A615E] hover:text-[#0D0D0D]')}
                style={mode === m ? { backgroundColor: CP_GREEN } : undefined}
              >
                {m === 'ONLINE' ? t('online') : t('inPerson')}
              </button>
            ))}
          </div>
          {mode === 'ONLINE' ? (
            <Field label={t('meetingLinkLabel')} htmlFor="cp-meet-link">
              <input id="cp-meet-link" type="url" value={link} dir="ltr"
                onChange={(e) => setLink(e.target.value)} placeholder="https://…" disabled={busy}
                className={cpInputClassLight} />
            </Field>
          ) : (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{t('confirmOfflineHeading')}</p>
              <Field label={t('addressLabel')} htmlFor="cp-meet-address">
                <input id="cp-meet-address" type="text" value={address} maxLength={500}
                  onChange={(e) => setAddress(e.target.value)} placeholder={t('addressPlaceholder')} disabled={busy}
                  className={cpInputClassLight} />
              </Field>
              <Field label={t('mapsLabel')} htmlFor="cp-meet-maps">
                <input id="cp-meet-maps" type="url" value={mapsLink} dir="ltr"
                  onChange={(e) => setMapsLink(e.target.value)} placeholder={t('mapsPlaceholder')} disabled={busy}
                  className={cpInputClassLight} />
              </Field>
            </div>
          )}
          {error && <ErrorBanner tone="light" message={error} />}
        </div>
      )}

      {view === 'reschedule' && (
        <div className="space-y-3">
          {back}
          <p className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{t('rescheduleHelp')}</p>
          <MentorScheduler
            mentorId={mentorId}
            selectedDate={resDate}
            onSelectDate={(d) => { setResDate(d); setResTime(null); }}
            selectedTime={resTime}
            onSelectTime={(slot: DaySlot) => setResTime(slot.start)}
            locale={locale}
          />
          {error && <ErrorBanner tone="light" message={error} />}
        </div>
      )}

      {view === 'cancel' && (
        <div className="space-y-3">
          {back}
          <p className="text-sm text-[#2A2F2C]">{t('cancelDescription')}</p>
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
            placeholder={t('cancelReasonPlaceholder')} disabled={busy} className={cpInputClassLight} />
          {error && <ErrorBanner tone="light" message={error} />}
        </div>
      )}
    </FlowSheet>
  );
}

function Fact({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs text-[#2A2F2C]" style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
      <span style={{ color: CP_LIGHT_MUTED }}>{icon}</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function Contact({ icon, label, value, dir }: { icon: React.ReactNode; label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span style={{ color: CP_LIGHT_FAINT }}>{icon}</span>
      <span style={{ color: CP_LIGHT_MUTED }}>{label}:</span>
      <span dir={dir} className="text-[#2A2F2C]">{value || '—'}</span>
    </div>
  );
}

function SecondaryBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        'inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors',
        danger
          ? 'border-red-200 text-red-700 hover:bg-red-50'
          : 'hover:bg-[#F7F8F9]',
      )}
      style={danger ? undefined : { borderColor: CP_LIGHT_BORDER, color: '#2A2F2C' }}
    >
      {children}
    </button>
  );
}
