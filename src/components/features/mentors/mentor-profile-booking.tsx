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
import { CalendarCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/auth-provider';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { MentorScheduler } from './mentor-scheduler';
import { BookConsultationDialog } from './book-consultation-dialog';
import type { DaySlot, Mentor } from '@/types/mentor';

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
  const [open, setOpen] = useState(false);

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
      <MentorScheduler
        mentorId={mentor.id}
        selectedDate={date}
        onSelectDate={(d) => { setDate(d); setTime(null); }}
        selectedTime={time}
        onSelectTime={(slot: DaySlot) => setTime(slot.start)}
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
        instantBookEnabled={instantBookEnabled}
      />
    </div>
  );
}
