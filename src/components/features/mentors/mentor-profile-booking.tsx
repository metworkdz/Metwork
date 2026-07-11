'use client';

/**
 * MentorProfileBooking — the interactive booking surface on a mentor's public
 * profile. It shows the live availability scheduler inline; the "Book an
 * appointment" CTA pre-seeds whatever date/time the visitor picked into the
 * existing BookConsultationDialog (PENDING flow, pricing, promo — all unchanged).
 *
 * Guests are bounced to /login with a `next` back to this profile, mirroring the
 * directory/slideshow behaviour.
 */
import { useState } from 'react';
import { CalendarCheck, Timer } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DURATION_OPTIONS, computePrice, resolveMentorPricing } from '@/lib/consultation-pricing';
import { formatCurrency } from '@/lib/format';
import { MentorScheduler } from './mentor-scheduler';
import { BookConsultationDialog } from './book-consultation-dialog';
import type { DaySlot, Mentor } from '@/types/mentor';
import type { Locale } from '@/i18n/config';

interface MentorProfileBookingProps {
  mentor: Mentor;
  /** When true, booking uses the instant-book, pay-first flow. */
  instantBookEnabled?: boolean;
}

export function MentorProfileBooking({ mentor, instantBookEnabled = false }: MentorProfileBookingProps) {
  const t = useTranslations('mentors.profile');
  const loc = useLocale();
  const schedulerLocale = loc === 'fr' || loc === 'ar' ? loc : 'en';
  const { user } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(60);
  const [open, setOpen] = useState(false);

  const { feePerHour } = resolveMentorPricing(mentor);
  const profilePath = `/mentors/${mentor.slug ?? mentor.id}`;

  function handleBook() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(profilePath)}`);
      return;
    }
    setOpen(true);
  }

  return (
    <div className="space-y-5">
      {/* Duration first — availability is duration-aware. */}
      <div className="space-y-1.5">
        <Label htmlFor="mpb-dur" className="flex items-center gap-1 text-xs">
          <Timer className="size-3.5" /> {t('durationLabel')}
        </Label>
        <Select
          value={String(duration)}
          onValueChange={(v) => { setDuration(Number(v)); setTime(null); }}
        >
          <SelectTrigger id="mpb-dur" className="text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {DURATION_OPTIONS.map((opt) => {
              const price = computePrice(feePerHour, opt.value);
              return (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  <span className="flex items-center justify-between gap-6">
                    <span>{opt.label}</span>
                    {feePerHour > 0 && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatCurrency(price, loc as Locale)}
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <MentorScheduler
        mentorId={mentor.id}
        selectedDate={date}
        onSelectDate={(d) => { setDate(d); setTime(null); }}
        selectedTime={time}
        onSelectTime={(slot: DaySlot) => setTime(slot.start)}
        durationMinutes={duration}
        locale={schedulerLocale}
      />

      <Button size="lg" className="w-full" onClick={handleBook}>
        <CalendarCheck className="size-4" />
        {t('bookCta')}
      </Button>

      <BookConsultationDialog
        mentor={mentor}
        open={open}
        onOpenChange={setOpen}
        initialDate={date}
        initialTime={time}
        initialDuration={duration}
        instantBookEnabled={instantBookEnabled}
      />
    </div>
  );
}
