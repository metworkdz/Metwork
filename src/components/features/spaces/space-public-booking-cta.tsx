'use client';

import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/components/providers/auth-provider';
import { SpaceDetailSheet } from './space-detail-sheet';
import type { Space } from '@/types/domain';

interface Props {
  space: Space;
  locale?: string;
}

export function SpacePublicBookingCTA({ space }: Props) {
  const { user } = useAuth();
  const t = useTranslations('spaces.detail');
  const [sheetOpen, setSheetOpen] = useState(false);

  const redirect = `/spaces/${space.id}`;

  // Space bookings are account-only — guest checkout is restricted to programs.
  // Anonymous visitors must sign in (or create an account) before booking.
  if (!user) {
    return (
      <div className="space-y-2">
        <Link href={`/login?redirect=${encodeURIComponent(redirect)}`}>
          <Button className="w-full" variant="default">
            <LogIn className="size-4" />
            {t('signInToBook')}
          </Button>
        </Link>
        <Link href={`/signup?redirect=${encodeURIComponent(redirect)}`}>
          <Button className="w-full" variant="outline">
            <UserPlus className="size-4" />
            {t('createAndBook')}
          </Button>
        </Link>
      </div>
    );
  }

  // Entrepreneurs and trainers (training centres / companies) may book spaces.
  if (user.role !== 'ENTREPRENEUR' && user.role !== 'TRAINER') {
    return (
      <p className="text-sm text-muted-foreground text-center">
        {t('entrepreneurOnly')}
      </p>
    );
  }

  return (
    <>
      <Button className="w-full" onClick={() => setSheetOpen(true)}>
        {t('bookThisSpace')}
      </Button>
      <SpaceDetailSheet
        space={space}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </>
  );
}
