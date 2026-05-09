'use client';

/**
 * Consultation booking dialog — with date, time, and duration selection.
 *
 * Rules:
 *  - Duration: 30 min minimum, 180 min (3 h) maximum, in 30-min steps
 *  - Consultations are free — no wallet debit
 *  - Status is always PENDING until admin approves
 *  - Success panel clearly says "pending approval" (not "confirmed")
 */
import { useState } from 'react';
import { Clock, Calendar, Timer } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Mentor } from '@/types/mentor';

interface BookConsultationDialogProps {
  mentor: Mentor | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const DURATION_OPTIONS = [
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 90,  label: '1 h 30' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2 h 30' },
  { value: 180, label: '3 hours' },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  const [consultDate, setConsultDate] = useState('');
  const [consultTime, setConsultTime] = useState('10:00');
  const [duration,    setDuration]    = useState<number>(60);
  const [formState,   setFormState]   = useState<FormState>('idle');
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  function reset() {
    setName(''); setEmail(''); setPhone(''); setMessage('');
    setConsultDate(''); setConsultTime('10:00'); setDuration(60);
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
          consultationDate: consultDate || null,
          consultationTime: consultDate ? consultTime : null,
          durationMinutes:  consultDate ? duration : null,
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        {formState === 'success' ? (
          /* ── Success: pending approval state ── */
          <div className="flex flex-col items-center py-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
              <Clock className="size-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Request submitted!</h2>
            <Badge variant="warning" className="mt-2">Pending review</Badge>
            <p className="mt-3 text-sm text-muted-foreground max-w-xs">
              Your consultation request with{' '}
              <span className="font-medium text-foreground">{mentor.fullName}</span>{' '}
              has been submitted. You will receive an email once it has been reviewed.
            </p>
            {consultDate && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
                <Calendar className="size-3.5 shrink-0" />
                <span>{consultDate} at {consultTime}</span>
                <span>·</span>
                <Timer className="size-3.5 shrink-0" />
                <span>{DURATION_OPTIONS.find((d) => d.value === duration)?.label}</span>
              </div>
            )}
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
              {/* Personal info */}
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
              <div className="grid grid-cols-2 gap-3">
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
              </div>

              {/* Preferred schedule (optional) */}
              <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Preferred schedule{' '}
                  <span className="normal-case font-normal text-muted-foreground/70">(optional)</span>
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="bc-date" className="flex items-center gap-1 text-xs">
                      <Calendar className="size-3.5" /> Date
                    </Label>
                    <Input
                      id="bc-date"
                      type="date"
                      min={todayStr()}
                      value={consultDate}
                      onChange={(e) => setConsultDate(e.target.value)}
                      disabled={formState === 'submitting'}
                      className="text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bc-time" className="flex items-center gap-1 text-xs">
                      <Clock className="size-3.5" /> Start time
                    </Label>
                    <Input
                      id="bc-time"
                      type="time"
                      value={consultTime}
                      onChange={(e) => setConsultTime(e.target.value)}
                      disabled={formState === 'submitting' || !consultDate}
                      className="text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bc-dur" className="flex items-center gap-1 text-xs">
                    <Timer className="size-3.5" /> Duration
                  </Label>
                  <Select
                    value={String(duration)}
                    onValueChange={(v) => setDuration(Number(v))}
                    disabled={formState === 'submitting'}
                  >
                    <SelectTrigger id="bc-dur" className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={String(opt.value)}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Message */}
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

              {/* Pending-review notice */}
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <Clock className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  Requests are reviewed by our team. You will receive a confirmation email once
                  approved — this is <strong>not</strong> an automatic booking.
                </span>
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
