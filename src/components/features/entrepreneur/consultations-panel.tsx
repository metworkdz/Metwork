'use client';

/**
 * Entrepreneur consultations panel.
 * Lists past consultations and lets the user book a new one with any mentor.
 * Calls POST /api/mentors/:id/consult for booking.
 */
import { useState } from 'react';
import { UserCheck, CheckCircle2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatCurrency, formatDate } from '@/lib/format';
import type { MentorConsultationRecord, MentorRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

const CONSULTATION_PRICE = 3_000;

interface Props {
  initial:          MentorConsultationRecord[];
  mentors:          MentorRecord[];
  freeQuota:        number;
  freeUsed:         number;
  membershipCode:   string | null;
  locale:           Locale;
}

export function ConsultationsPanel({
  initial,
  mentors,
  freeQuota,
  freeUsed,
  membershipCode,
  locale,
}: Props) {
  const [consultations, setConsultations] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    chargeType: string;
    amount: number;
    mentorName: string;
  } | null>(null);

  const freeRemaining = Math.max(0, freeQuota - freeUsed);
  const selectedMentor = mentors.find((m) => m.id === selectedMentorId);

  function openDialog() {
    setSelectedMentorId(mentors[0]?.id ?? '');
    setMessage('');
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  async function submit() {
    if (!selectedMentorId || message.trim().length < 10) {
      setError('Please select a mentor and write at least 10 characters.');
      return;
    }
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/mentors/${selectedMentorId}/consult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string; details?: { balance?: number } } };
        if (d.error?.message?.includes('wallet') || d.error?.message?.includes('balance')) {
          throw new Error(`Insufficient wallet balance. You need ${CONSULTATION_PRICE.toLocaleString()} DZD. Please top up your wallet.`);
        }
        throw new Error(d.error?.message ?? 'Booking failed');
      }
      const data = await res.json() as {
        id: string;
        chargeType: string;
        amountCharged: number;
        freeSessionsUsed: number;
        freeQuota: number;
      };

      const mentor = mentors.find((m) => m.id === selectedMentorId);
      setSuccess({
        chargeType: data.chargeType,
        amount: data.amountCharged,
        mentorName: mentor?.fullName ?? 'the mentor',
      });

      // Refresh list (simple approach: prepend the new record with minimal info)
      const now = new Date().toISOString();
      setConsultations((prev) => [
        {
          id: data.id,
          mentorId: selectedMentorId,
          mentorName: mentor?.fullName ?? '',
          userId: '',
          chargeType: data.chargeType as 'FREE_QUOTA' | 'PAID',
          amountCharged: data.amountCharged,
          transactionId: null,
          status: 'CONFIRMED',
          quotaMonth: '',
          message: message.trim(),
          createdAt: now,
          updatedAt: now,
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Quota banner */}
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {freeQuota > 0 ? (
              <>Free sessions this month: <span className="text-primary-700">{freeUsed} / {freeQuota} used</span></>
            ) : (
              membershipCode
                ? <>All sessions charged at <span className="font-semibold">{formatCurrency(CONSULTATION_PRICE, locale)}</span>/session</>
                : <>Upgrade your membership to get free monthly sessions</>
            )}
          </p>
          {freeRemaining > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {freeRemaining} free session{freeRemaining !== 1 ? 's' : ''} remaining — 30 min each
            </p>
          )}
          {freeRemaining === 0 && freeQuota > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Free quota used. Additional sessions are {formatCurrency(CONSULTATION_PRICE, locale)} each.
            </p>
          )}
        </div>
        <Button size="sm" onClick={openDialog} disabled={mentors.length === 0}>
          Book a session
        </Button>
      </div>

      {/* History table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consultation history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {consultations.length === 0 ? (
            <InlineEmptyState
              title="No consultations yet"
              description="Book a 30-min session with any of our mentors."
              icon={<UserCheck className="size-5 text-muted-foreground" />}
              action={
                <Button size="sm" onClick={openDialog} disabled={mentors.length === 0}>
                  Book your first session
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mentor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Charge</TableHead>
                    <TableHead className="text-end">Amount</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consultations.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.mentorName}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === 'CONFIRMED' ? 'success' : 'danger'}>
                          {c.status.toLowerCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.chargeType === 'FREE_QUOTA' ? 'info' : 'default'}>
                          {c.chargeType === 'FREE_QUOTA' ? 'Free quota' : 'Paid'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {c.amountCharged > 0
                          ? formatCurrency(c.amountCharged, locale)
                          : <span className="text-emerald-600">Free</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(c.createdAt, locale, { dateStyle: 'medium' })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o && !saving) setDialogOpen(false); }}>
        <DialogContent className="max-w-sm">
          {success ? (
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-50">
                <CheckCircle2 className="size-7 text-emerald-600" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Session booked!</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your 30-min consultation with{' '}
                <span className="font-medium text-foreground">{success.mentorName}</span> is confirmed.
                {success.chargeType === 'FREE_QUOTA'
                  ? ' This session was deducted from your free monthly quota.'
                  : ` ${formatCurrency(success.amount, locale)} was charged from your wallet.`}
              </p>
              <Button className="mt-6" onClick={() => setDialogOpen(false)}>Done</Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Book a consultation</DialogTitle>
                <DialogDescription>
                  30 min · {freeRemaining > 0
                    ? `Free (${freeRemaining} remaining)`
                    : formatCurrency(CONSULTATION_PRICE, locale)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Mentor</Label>
                  <Select value={selectedMentorId} onValueChange={setSelectedMentorId}>
                    <SelectTrigger><SelectValue placeholder="Select a mentor" /></SelectTrigger>
                    <SelectContent>
                      {mentors.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.fullName} — {m.position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMentor && (
                    <p className="text-xs text-muted-foreground">{selectedMentor.bio ?? ''}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="consult-msg">What do you need help with?</Label>
                  <textarea
                    id="consult-msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder="Describe your situation and what you're hoping to get from the session…"
                    className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum 10 characters ({message.length}/1000)
                  </p>
                </div>

                {error && (
                  <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button loading={saving} onClick={submit}>
                  {freeRemaining > 0 ? 'Book for free' : `Book — ${formatCurrency(CONSULTATION_PRICE, locale)}`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
