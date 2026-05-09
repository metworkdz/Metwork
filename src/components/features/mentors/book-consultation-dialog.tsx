'use client';

import { useState } from 'react';
import { CheckCircle2, Calendar } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Mentor } from '@/types/mentor';

interface BookConsultationDialogProps {
  mentor: Mentor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

/** Returns the min allowed datetime-local string (24h from now). */
function minScheduledAt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000 + 60 * 1000);
  // datetime-local format: YYYY-MM-DDTHH:MM
  return d.toISOString().slice(0, 16);
}

export function BookConsultationDialog({
  mentor,
  open,
  onOpenChange,
}: BookConsultationDialogProps) {
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [message,     setMessage]     = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [promoCode,   setPromoCode]   = useState('');
  const [formState,   setFormState]   = useState<FormState>('idle');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [discountApplied, setDiscountApplied] = useState<number | null>(null);

  function reset() {
    setName(''); setEmail(''); setPhone(''); setMessage(''); setScheduledAt('');
    setPromoCode(''); setDiscountApplied(null);
    setFormState('idle'); setErrorMsg(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!mentor) return;

    // Client-side 24h guard (server also validates)
    const scheduled = new Date(scheduledAt);
    if (scheduled < new Date(Date.now() + 24 * 60 * 60 * 1000)) {
      setErrorMsg('Please choose a date and time at least 24 hours from now.');
      setFormState('error');
      return;
    }

    setFormState('submitting');
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/mentors/${mentor.id}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          email,
          phone,
          message,
          scheduledAt: new Date(scheduledAt).toISOString(),
          ...(promoCode.trim() ? { promoCode: promoCode.trim().toUpperCase() } : {}),
        }),
      });
      if (res.status === 401) {
        setErrorMsg('Please log in to book a consultation.');
        setFormState('error');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setErrorMsg(data.error?.message ?? 'Something went wrong. Please try again.');
        setFormState('error');
        return;
      }
      const data = await res.json().catch(() => ({})) as { discountPercent?: number };
      if (data.discountPercent) setDiscountApplied(data.discountPercent);
      setFormState('success');
    } catch {
      setErrorMsg('Network error. Please check your connection.');
      setFormState('error');
    }
  }

  if (!mentor) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {formState === 'success' ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="size-7 text-emerald-600" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Request sent!</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your consultation request with{' '}
              <span className="font-medium text-foreground">{mentor.fullName}</span> has
              been submitted. Our team will review it and confirm your preferred time shortly.
            </p>
            {discountApplied ? (
              <p className="mt-2 text-sm font-medium text-emerald-600">
                🎉 {discountApplied}% discount applied via promo code.
              </p>
            ) : null}
            <Button className="mt-6" onClick={() => handleOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3">
                {mentor.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mentor.imageUrl}
                    alt={mentor.fullName}
                    className="size-12 rounded-full object-cover"
                  />
                )}
                <div>
                  <DialogTitle>Book a consultation</DialogTitle>
                  <DialogDescription>
                    with {mentor.fullName} · {mentor.position}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bc-name">Full name</Label>
                <Input
                  id="bc-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                  disabled={formState === 'submitting'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-email">Email</Label>
                <Input
                  id="bc-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={formState === 'submitting'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-phone">Phone</Label>
                <Input
                  id="bc-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+213 555 00 00 00"
                  required
                  dir="ltr"
                  disabled={formState === 'submitting'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-scheduled">Preferred date &amp; time</Label>
                <Input
                  id="bc-scheduled"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  min={minScheduledAt()}
                  required
                  disabled={formState === 'submitting'}
                />
                <p className="text-xs text-muted-foreground">
                  Must be at least 24 hours from now. Admin may adjust before confirming.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bc-message">What do you need help with?</Label>
                <textarea
                  id="bc-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Describe your situation and what you're hoping to get from the session…"
                  required
                  disabled={formState === 'submitting'}
                  className={cn(
                    'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors',
                    'placeholder:text-muted-foreground',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                    'disabled:cursor-not-allowed disabled:opacity-50',
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bc-promo">Promo code <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="bc-promo"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  placeholder="e.g. LAUNCH20"
                  className="font-mono uppercase"
                  maxLength={32}
                  disabled={formState === 'submitting'}
                />
              </div>

              {errorMsg && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {errorMsg}
                </p>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={formState === 'submitting'}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={formState === 'submitting'}>
                  <Calendar className="size-4" />
                  Send request
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
