'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown, CheckCircle2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/routing';
import type { Locale } from '@/i18n/config';

/**
 * Cancel a paid plan: schedules the switch to Free at the end of the paid
 * period. For a monthly plan this is also what stops the auto-renewal.
 */
interface Props {
  targetPlan: 'FREE';
  targetName: string;
  /** ISO date when the change will take effect (membership expiry). Null = ~30 days from now. */
  scheduledDate: string | null;
  locale: Locale;
  /** True if user has already scheduled a downgrade to this exact tier. */
  alreadyScheduled?: boolean;
}

export function MembershipDowngradeButton({
  targetPlan,
  targetName,
  scheduledDate,
  locale,
  alreadyScheduled = false,
}: Props) {
  const t = useTranslations('membership.cancel');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'confirm' | 'success'>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const formattedDate = scheduledDate
    ? new Date(scheduledDate).toLocaleDateString(locale, { dateStyle: 'long' })
    : t('periodEnd');

  function handleConfirm() {
    setErrorMsg('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/memberships/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: targetPlan }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // The API error envelope is `{ error: { code, message } }`.
          const err = (data as { error?: { message?: string } }).error;
          setErrorMsg(err?.message ?? t('error'));
          return;
        }
        setStep('success');
        setTimeout(() => {
          setOpen(false);
          setStep('confirm');
          router.refresh();
        }, 1800);
      } catch {
        setErrorMsg(t('networkError'));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="w-full text-muted-foreground"
        onClick={() => {
          setStep('confirm');
          setErrorMsg('');
          setOpen(true);
        }}
        disabled={alreadyScheduled}
      >
        <ArrowDown className="size-4" />
        {alreadyScheduled ? t('scheduled') : t('button', { plan: targetName })}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {step === 'confirm' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('title', { plan: targetName })}</DialogTitle>
                <DialogDescription>
                  {t('body', { plan: targetName, date: formattedDate })}
                </DialogDescription>
              </DialogHeader>

              {errorMsg && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                  {errorMsg}
                </p>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isPending}
                >
                  {t('keep')}
                </Button>
                <Button onClick={handleConfirm} loading={isPending}>
                  {isPending ? t('scheduling') : t('confirm')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="size-10 text-green-600" />
              <p className="text-center text-sm font-medium">
                {t('done', { date: formattedDate })}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
