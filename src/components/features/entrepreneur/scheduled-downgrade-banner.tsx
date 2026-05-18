'use client';

import { useTransition } from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/config';

interface Props {
  targetName: string;
  scheduledDate: string;
  locale: Locale;
}

export function ScheduledDowngradeBanner({ targetName, scheduledDate, locale }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const formatted = new Date(scheduledDate).toLocaleDateString(locale, {
    dateStyle: 'long',
  });

  function cancelDowngrade() {
    startTransition(async () => {
      try {
        const res = await fetch('/api/memberships/downgrade', { method: 'DELETE' });
        if (res.ok) router.refresh();
      } catch {
        // Silent — banner stays so the user can retry.
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <CalendarClock className="mt-0.5 size-5 shrink-0 text-amber-700" />
        <div>
          <p className="font-medium text-amber-900">
            Scheduled downgrade to {targetName}
          </p>
          <p className="text-xs text-amber-800">
            Takes effect on {formatted}. You&apos;ll keep your current benefits until then.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={cancelDowngrade}
        loading={isPending}
        className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
      >
        {isPending ? 'Cancelling…' : 'Keep current plan'}
      </Button>
    </div>
  );
}
