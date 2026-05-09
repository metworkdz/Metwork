'use client';

/**
 * Client component: renders the entrepreneur's bookings and lets them
 * cancel PENDING / CONFIRMED bookings via PATCH /api/bookings/:id.
 */
import { useState } from 'react';
import { Calendar, QrCode, Info } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { BookingStatusBadge } from '@/components/features/booking/booking-status-badge';
import { formatCurrency, formatDate } from '@/lib/format';
import type { BookingRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface Props {
  initial: BookingRecord[];
  locale:  Locale;
}

export function MyBookingsTable({ initial, locale }: Props) {
  const [rows, setRows] = useState<BookingRecord[]>(initial);
  const [cancelling, setCancelling] = useState<BookingRecord | null>(null);
  const [qrBooking,  setQrBooking]  = useState<BookingRecord | null>(null);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCancel = (b: BookingRecord) =>
    b.status === 'PENDING' || b.status === 'CONFIRMED';

  async function confirmCancel() {
    if (!cancelling) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/bookings/${cancelling.id}`, {
        method: 'PATCH',
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(d.error?.message ?? 'Cancel failed');
      }
      setRows((prev) =>
        prev.map((b) => b.id === cancelling.id ? { ...b, status: 'CANCELLED' as const } : b),
      );
      setCancelling(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  const upcoming = rows.filter((b) => b.status === 'CONFIRMED' || b.status === 'PENDING').length;
  const past     = rows.filter((b) => b.status === 'COMPLETED' || b.status === 'CANCELLED').length;
  const totalSpent = rows
    .filter((b) => b.status !== 'CANCELLED' && b.status !== 'REFUNDED')
    .reduce((s, b) => s + b.totalAmount, 0);

  return (
    <>
      {/* Summary tiles */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryTile label="Upcoming"    value={upcoming}                            accent="primary" />
        <SummaryTile label="Past"        value={past}                                accent="muted"   />
        <SummaryTile label="Total spent" value={formatCurrency(totalSpent, locale)} accent="muted"   />
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="No bookings yet"
              description="Browse coworking spaces, training rooms, and programs."
              icon={<Calendar className="size-5 text-muted-foreground" />}
              action={
                <Button asChild size="sm">
                  <Link href="/spaces">Browse spaces</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Total</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.itemName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <div>{b.vendorName}</div>
                        <div className="text-xs">{b.city}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(b.startsAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={b.itemKind === 'PROGRAM' ? 'info' : 'outline'}>
                          {b.itemKind === 'PROGRAM' ? 'Program'
                           : b.itemKind === 'EVENT'  ? 'Event'
                           : 'Space'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell className="text-end tabular-nums font-medium">
                        {formatCurrency(b.totalAmount, locale)}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex items-center justify-end gap-1">
                          {b.status === 'CONFIRMED' && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-8 text-primary-700"
                                    onClick={() => setQrBooking(b)}
                                  >
                                    <QrCode className="size-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Show QR code</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {b.status === 'CANCELLED' && b.declineReason && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
                                    <Info className="size-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[220px]">
                                  <p className="text-xs font-semibold">Decline reason</p>
                                  <p className="text-xs">{b.declineReason}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {canCancel(b) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => { setCancelling(b); setError(null); }}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* QR code dialog */}
      <Dialog open={qrBooking !== null} onOpenChange={(o) => { if (!o) setQrBooking(null); }}>
        <DialogContent className="max-w-xs text-center">
          <DialogHeader>
            <DialogTitle>Booking QR Code</DialogTitle>
            <DialogDescription>
              {qrBooking && (
                <>Present this code at <span className="font-medium">{qrBooking.vendorName}</span>.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {qrBooking && (
            <div className="flex flex-col items-center gap-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`METWORK:${qrBooking.id}`)}`}
                alt="Booking QR Code"
                width={200}
                height={200}
                className="rounded-lg border"
              />
              <p className="font-mono text-sm text-muted-foreground">
                {qrBooking.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          )}
          <DialogFooter>
            <Button className="w-full" onClick={() => setQrBooking(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm-cancel dialog */}
      <Dialog
        open={cancelling !== null}
        onOpenChange={(o) => { if (!o) { setCancelling(null); setError(null); } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel booking?</DialogTitle>
            <DialogDescription>
              {cancelling && (
                <>
                  Cancel your booking for{' '}
                  <span className="font-medium">{cancelling.itemName}</span>?
                  This action cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" loading={busy} onClick={confirmCancel}>
              Yes, cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: 'primary' | 'muted';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={accent === 'primary' ? 'mt-2 text-2xl font-semibold text-primary-700' : 'mt-2 text-2xl font-semibold'}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
