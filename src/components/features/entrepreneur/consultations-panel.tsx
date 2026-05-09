'use client';

/**
 * Entrepreneur consultations panel.
 * Lists the user's consultation booking requests and lets them submit new ones.
 *
 * Booking flow:
 *   POST /api/mentors/:id/book  →  status: PENDING
 *   Admin reviews  →  APPROVED (confirmation email) | REJECTED
 *
 * DOES NOT auto-confirm or charge the wallet. All bookings require admin review.
 */
import { useState } from 'react';
import { Clock, UserCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { formatDate } from '@/lib/format';
import type { MentorBookingRecord, MentorRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface Props {
  /** Existing mentor booking requests for this user, newest first. */
  initial:        MentorBookingRecord[];
  mentors:        MentorRecord[];
  /** How many free consultations this user's plan includes per month (for display). */
  freeQuota:      number;
  membershipCode: string | null;
  locale:         Locale;
  /** Pre-filled from the user's profile. */
  userName:       string;
  userEmail:      string;
  userPhone:      string;
}

type BookingStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

function StatusBadge({ status }: { status: BookingStatus }) {
  if (status === 'APPROVED') return <Badge variant="success">Approved</Badge>;
  if (status === 'REJECTED') return <Badge variant="danger">Rejected</Badge>;
  return <Badge variant="warning">Pending review</Badge>;
}

export function ConsultationsPanel({
  initial,
  mentors,
  freeQuota,
  membershipCode,
  locale,
  userName,
  userEmail,
  userPhone,
}: Props) {
  const [bookings, setBookings]     = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Dialog form state
  const [selectedMentorId, setSelectedMentorId] = useState('');
  const [phone, setPhone]     = useState(userPhone);
  const [message, setMessage] = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<{ mentorName: string } | null>(null);

  const selectedMentor = mentors.find((m) => m.id === selectedMentorId);

  function openDialog() {
    setSelectedMentorId(mentors[0]?.id ?? '');
    setPhone(userPhone);
    setMessage('');
    setError(null);
    setSuccess(null);
    setDialogOpen(true);
  }

  async function submit() {
    if (!selectedMentorId) {
      setError('Please select a mentor.');
      return;
    }
    if (phone.trim().length < 6) {
      setError('Please enter a valid phone number.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Please describe what you need help with (at least 10 characters).');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/mentors/${selectedMentorId}/book`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name:             userName,
          email:            userEmail,
          phone:            phone.trim(),
          message:          message.trim(),
          consultationDate: null,
          consultationTime: null,
          durationMinutes:  null,
          promoCode:        null,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Booking request failed. Please try again.');
      }

      const data = await res.json() as { id: string };
      const mentor = mentors.find((m) => m.id === selectedMentorId);

      setSuccess({ mentorName: mentor?.fullName ?? 'the mentor' });

      // Optimistic insert with PENDING status
      const now = new Date().toISOString();
      setBookings((prev) => [
        {
          id:                   data.id,
          mentorId:             selectedMentorId,
          userId:               null,
          userName,
          userEmail,
          userPhone:            phone.trim(),
          message:              message.trim(),
          status:               'PENDING' as const,
          adminNote:            null,
          consultationDate:     null,
          consultationTime:     null,
          durationMinutes:      null,
          appliedPromoCode:     null,
          promoDiscountPercent: null,
          createdAt:            now,
          updatedAt:            now,
        },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Booking request failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Quota / plan info banner */}
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {freeQuota > 0 ? (
              <>
                Your plan includes{' '}
                <span className="text-primary-700">
                  {freeQuota} free consultation{freeQuota !== 1 ? 's' : ''}
                </span>{' '}
                per month
              </>
            ) : membershipCode ? (
              <>Consultations are available on request</>
            ) : (
              <>Upgrade your membership to unlock free monthly consultations</>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Requests are reviewed by our team. You'll receive an email once yours is approved.
          </p>
        </div>
        <Button size="sm" onClick={openDialog} disabled={mentors.length === 0}>
          Book a session
        </Button>
      </div>

      {/* Booking history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consultation requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {bookings.length === 0 ? (
            <InlineEmptyState
              title="No consultation requests yet"
              description="Submit a request to connect with one of our mentors."
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
                    <TableHead>Duration</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.map((b) => {
                    const mentor = mentors.find((m) => m.id === b.mentorId);
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="font-medium">
                          {mentor?.fullName ?? b.userName}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={b.status as BookingStatus} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {b.durationMinutes ? `${b.durationMinutes} min` : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(b.createdAt, locale, { dateStyle: 'medium' })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => { if (!open && !saving) setDialogOpen(false); }}
      >
        <DialogContent className="max-w-sm">
          {success ? (
            /* ── Pending-approval success state ── */
            <div className="flex flex-col items-center py-6 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-amber-50 dark:bg-amber-950">
                <Clock className="size-7 text-amber-500 dark:text-amber-400" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">Request submitted!</h2>
              <Badge variant="warning" className="mt-2">Pending review</Badge>
              <p className="mt-3 text-sm text-muted-foreground max-w-xs">
                Your consultation request with{' '}
                <span className="font-medium text-foreground">{success.mentorName}</span>{' '}
                has been submitted. You will receive an email once the admin reviews it.
              </p>
              <Button className="mt-6" onClick={() => setDialogOpen(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Book a consultation</DialogTitle>
                <DialogDescription>
                  Your request will be reviewed before being confirmed — this is not an automatic
                  booking.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Mentor selector */}
                <div className="space-y-1.5">
                  <Label>Mentor</Label>
                  <Select value={selectedMentorId} onValueChange={setSelectedMentorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a mentor" />
                    </SelectTrigger>
                    <SelectContent>
                      {mentors.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.fullName} — {m.position}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedMentor?.bio && (
                    <p className="text-xs text-muted-foreground">{selectedMentor.bio}</p>
                  )}
                </div>

                {/* Phone (pre-filled, editable) */}
                <div className="space-y-1.5">
                  <Label htmlFor="consult-phone">Phone number</Label>
                  <Input
                    id="consult-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+213 555 00 00 00"
                    dir="ltr"
                    disabled={saving}
                  />
                </div>

                {/* Message */}
                <div className="space-y-1.5">
                  <Label htmlFor="consult-msg">What do you need help with?</Label>
                  <textarea
                    id="consult-msg"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    placeholder="Describe your situation and what you're hoping to get from the session…"
                    disabled={saving}
                    className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum 10 characters ({message.length} / 1000)
                  </p>
                </div>

                {/* Pending-review notice */}
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <Clock className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    Requests are reviewed by our team. You will receive a confirmation email once
                    approved — this is <strong>not</strong> an automatic booking.
                  </span>
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                  >
                    {error}
                  </p>
                )}
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button loading={saving} onClick={submit}>
                  Send request
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
