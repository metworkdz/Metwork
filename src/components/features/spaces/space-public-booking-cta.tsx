'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/auth-provider';
import { SpaceBookingForm, BookingSuccessPanel } from './space-booking-form';
import type { Space } from '@/types/domain';
import type { BookingDto } from '@/types/booking';

interface Props {
  space: Space;
  locale?: string;
}

/**
 * Inline booking widget on the public space page — the SAME widget for everyone:
 *   - Logged-out visitors pick a date/time + payment option; the CTAs persist the
 *     selection and route to signup/login, which resume straight to payment.
 *   - Entrepreneurs book directly (no detour).
 *   - Other authenticated roles can't book a space → a short note. Since the
 *     Business→Incubator merge this includes former BUSINESS accounts (now
 *     INCUBATOR): they're treated identically to a real incubator, which
 *     never had this ability either — providers manage listings, they don't
 *     self-book as a customer through this marketplace flow.
 */
export function SpacePublicBookingCTA({ space }: Props) {
  const { user } = useAuth();
  const t = useTranslations('spaces.detail');
  const [success, setSuccess] = useState<{ booking: BookingDto; newBalance: number } | null>(null);

  // Spaces are bookable by entrepreneurs; other authed roles get a note.
  if (user && user.role !== 'ENTREPRENEUR') {
    return (
      <p className="text-sm text-muted-foreground text-center">
        {t('entrepreneurOnly')}
      </p>
    );
  }

  if (success) {
    return <BookingSuccessPanel booking={success.booking} newBalance={success.newBalance} />;
  }

  return (
    <SpaceBookingForm
      space={space}
      onSuccess={(booking, newBalance) => setSuccess({ booking, newBalance })}
    />
  );
}
