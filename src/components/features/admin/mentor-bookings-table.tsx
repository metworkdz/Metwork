'use client';

import { useState } from 'react';
import { Check, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MentorBookingStatus } from '@/server/db/store';

export interface BookingRow {
  id: string;
  mentorId: string;
  mentorName: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  message: string;
  status: MentorBookingStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_BADGE: Record<MentorBookingStatus, { variant: 'warning' | 'success' | 'danger'; label: string }> = {
  PENDING:  { variant: 'warning', label: 'Pending' },
  APPROVED: { variant: 'success', label: 'Approved' },
  REJECTED: { variant: 'danger',  label: 'Rejected' },
};

interface ReviewDialogProps {
  booking: BookingRow | null;
  onClose: () => void;
  onSave: (id: string, status: 'APPROVED' | 'REJECTED', note: string) => Promise<void>;
}

function ReviewDialog({ booking, onClose, onSave }: ReviewDialogProps) {
  const [note,     setNote]     = useState('');
  const [saving,   setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(status: 'APPROVED' | 'REJECTED') {
    if (!booking) return;
    setSaving(true); setErrorMsg(null);
    try {
      await onSave(booking.id, status, note);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={booking !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Review booking request</DialogTitle>
          {booking && (
            <DialogDescription>
              {booking.userName} → {booking.mentorName}
            </DialogDescription>
          )}
        </DialogHeader>

        {booking && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-sm space-y-1">
              <p><span className="font-medium">Email:</span> {booking.userEmail}</p>
              <p><span className="font-medium">Phone:</span> {booking.userPhone}</p>
              <p className="mt-2 text-muted-foreground">{booking.message}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="admin-note">Note to requester (optional)</Label>
              <textarea
                id="admin-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Add a note explaining your decision or next steps…"
                disabled={saving}
                className={cn(
                  'flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm',
                  'placeholder:text-muted-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                )}
              />
            </div>

            {errorMsg && (
              <p className="text-xs text-destructive">{errorMsg}</p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={saving}
            onClick={() => submit('REJECTED')}
          >
            <X className="size-4" /> Reject
          </Button>
          <Button
            loading={saving}
            onClick={() => submit('APPROVED')}
          >
            <Check className="size-4" /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MentorBookingsTableProps {
  initial: BookingRow[];
}

export function MentorBookingsTable({ initial }: MentorBookingsTableProps) {
  const [rows,       setRows]       = useState<BookingRow[]>(initial);
  const [reviewing,  setReviewing]  = useState<BookingRow | null>(null);
  const [statusFilter, setFilter]   = useState<MentorBookingStatus | 'ALL'>('ALL');

  const filters: Array<{ value: MentorBookingStatus | 'ALL'; label: string }> = [
    { value: 'ALL',      label: 'All' },
    { value: 'PENDING',  label: 'Pending' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  const visible = statusFilter === 'ALL'
    ? rows
    : rows.filter((r) => r.status === statusFilter);

  async function handleSave(id: string, status: 'APPROVED' | 'REJECTED', note: string) {
    const res = await fetch(`/api/admin/mentor-bookings/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status, adminNote: note || undefined }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(data.error?.message ?? 'Failed to update booking');
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === id ? { ...r, status, adminNote: note || null, updatedAt: new Date().toISOString() } : r,
      ),
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 w-fit">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              statusFilter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            {f.value !== 'ALL' && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                ({rows.filter((r) => r.status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No booking requests{statusFilter !== 'ALL' ? ` with status "${statusFilter}"` : ''} yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row) => {
            const badge = STATUS_BADGE[row.status];
            return (
              <Card key={row.id} className="border-border/60">
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-foreground truncate">{row.userName}</p>
                        <span className="text-muted-foreground">→</span>
                        <p className="text-sm font-medium text-primary truncate">{row.mentorName}</p>
                        <Badge variant={badge.variant} className="text-xs">
                          {badge.label}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {row.userEmail} · {row.userPhone}
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground line-clamp-2">
                        {row.message}
                      </p>
                      {row.adminNote && (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          Note: {row.adminNote}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground/60">
                        Submitted {new Date(row.createdAt).toLocaleString()}
                      </p>
                    </div>

                    {row.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={() => setReviewing(row)}
                      >
                        Review
                        <ChevronDown className="size-3" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ReviewDialog
        booking={reviewing}
        onClose={() => setReviewing(null)}
        onSave={handleSave}
      />
    </div>
  );
}
