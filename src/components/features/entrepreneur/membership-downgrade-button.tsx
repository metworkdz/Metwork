'use client';

import { useState, useTransition } from 'react';
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

interface Props {
  targetPlan: 'ENTREPRENEUR' | 'FREE';
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'confirm' | 'success'>('confirm');
  const [errorMsg, setErrorMsg] = useState('');
  const [isPending, startTransition] = useTransition();

  const formattedDate = scheduledDate
    ? new Date(scheduledDate).toLocaleDateString(locale, { dateStyle: 'long' })
    : 'the end of your current billing period';

  function handleConfirm() {
    setErrorMsg('');
    startTransition(async () => {
      try {
        const res = await fetch('/api/memberships/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: targetPlan }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.message ?? 'Could not schedule downgrade. Please try again.');
          return;
        }
        setStep('success');
        setTimeout(() => {
          setOpen(false);
          setStep('confirm');
          router.refresh();
        }, 1800);
      } catch {
        setErrorMsg('Network error. Please try again.');
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
        {alreadyScheduled ? 'Downgrade scheduled' : `Downgrade to ${targetName}`}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          {step === 'confirm' ? (
            <>
              <DialogHeader>
                <DialogTitle>Downgrade to {targetName}</DialogTitle>
                <DialogDescription>
                  You&apos;ll be downgraded to <strong>{targetName}</strong> on{' '}
                  <strong>{formattedDate}</strong>. You&apos;ll keep your current benefits
                  until then.
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
                  Cancel
                </Button>
                <Button onClick={handleConfirm} loading={isPending}>
                  {isPending ? 'Scheduling…' : 'Confirm downgrade'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6">
              <CheckCircle2 className="size-10 text-green-600" />
              <p className="text-center text-sm font-medium">
                Downgrade scheduled for {formattedDate}.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
