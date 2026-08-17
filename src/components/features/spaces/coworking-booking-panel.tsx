'use client';

/**
 * COWORKING booking panel for the public space detail page.
 *
 * Flow: pick a day (today … +30) → fetch that day's AVAILABLE desks from the
 * canonical endpoint (`GET /api/spaces/:id/desks?date=`) → pick one of the green
 * "Available" desk cards (taken desks are never shown) → "Book this desk" hands
 * off to the SAME SpaceBookingForm, pre-filled with the date + desk so the
 * server blocks that unit on booking.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Armchair, CalendarDays, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers/auth-provider';
import { SpaceBookingForm, BookingSuccessPanel } from './space-booking-form';
import type { Space } from '@/types/domain';
import type { BookingDto } from '@/types/booking';

interface Props {
  space: Space;
}

/** "YYYY-MM-DD" for today + n days, local time. */
function dayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function CoworkingBookingPanel({ space }: Props) {
  const t = useTranslations('spaces.detail');
  const { user } = useAuth();

  const today = dayStr(0);
  const maxDate = dayStr(30);

  const [date, setDate] = useState(today);
  const [desks, setDesks] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [selectedDesk, setSelectedDesk] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [success, setSuccess] = useState<{ booking: BookingDto; newBalance: number } | null>(null);

  const loadDesks = useCallback(async (forDate: string) => {
    setLoading(true);
    setError(false);
    setDesks(null);
    setSelectedDesk(null);
    try {
      const res = await fetch(`/api/spaces/${space.id}/desks?date=${forDate}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { available: string[] };
      setDesks(data.available ?? []);
    } catch {
      setError(true);
      setDesks([]);
    } finally {
      setLoading(false);
    }
  }, [space.id]);

  // Load desks for the initial date and whenever the date changes (unless we've
  // already handed off to the booking form).
  useEffect(() => {
    if (booking) return;
    void loadDesks(date);
  }, [date, booking, loadDesks]);

  // Only entrepreneurs can book; other authed roles get a note (since the
  // Business→Incubator merge this includes former BUSINESS accounts, now
  // treated identically to a real incubator — see space-public-booking-cta.tsx).
  if (user && user.role !== 'ENTREPRENEUR') {
    return (
      <p className="text-sm text-muted-foreground text-center">{t('entrepreneurOnly')}</p>
    );
  }

  if (success) {
    return <BookingSuccessPanel booking={success.booking} newBalance={success.newBalance} />;
  }

  // ── Step 2: booking form for the chosen desk ──
  if (booking && selectedDesk) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setBooking(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← {t('changeDesk')}
        </button>
        <SpaceBookingForm
          space={space}
          deskName={selectedDesk}
          initialStartDate={date}
          initialEndDate={date}
          onSuccess={(b, newBalance) => setSuccess({ booking: b, newBalance })}
        />
      </div>
    );
  }

  // ── Step 1: date + desk selection ──
  return (
    <div className="space-y-4">
      {/* Date picker */}
      <div className="space-y-1.5">
        <Label htmlFor="desk-date" className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5" />
          {t('selectDate')}
        </Label>
        <input
          id="desk-date"
          type="date"
          value={date}
          min={today}
          max={maxDate}
          onChange={(e) => setDate(e.target.value || today)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
      </div>

      {/* Desk list */}
      <div className="space-y-2">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t('loadingDesks')}
          </div>
        )}

        {!loading && error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t('desksError')}
          </p>
        )}

        {!loading && !error && desks != null && desks.length === 0 && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">
            {t('noDesksAvailable')}
          </p>
        )}

        {!loading && !error && desks != null && desks.length > 0 && (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('availableDesksLabel', { count: desks.length })}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {desks.map((name) => {
                const active = selectedDesk === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedDesk(name)}
                    aria-pressed={active}
                    className={cn(
                      'flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-start transition-colors',
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:border-primary/40',
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <Armchair className="size-3.5 text-muted-foreground" />
                      {name}
                    </span>
                    <Badge variant="success" className="gap-1 text-[11px]">
                      <CheckCircle2 className="size-3" />
                      {t('deskAvailable')}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!selectedDesk}
        onClick={() => setBooking(true)}
      >
        {t('bookThisDesk')}
      </Button>
    </div>
  );
}
