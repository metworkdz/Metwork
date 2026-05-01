'use client';

/**
 * Pending-listings approval queue. Each row resolves to either approved
 * or rejected; once decided it disappears from the queue. Real approval
 * actions will hit /api/admin/listings/:id with PATCH state changes.
 */
import { useState } from 'react';
import { useLocale } from 'next-intl';
import { Briefcase, Building2, Calendar, Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatCurrency, formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { PendingListingRow } from '@/lib/demo-data';

const kindIcon: Record<PendingListingRow['kind'], React.ReactNode> = {
  SPACE: <Building2 className="size-3.5" />,
  PROGRAM: <Briefcase className="size-3.5" />,
  EVENT: <Calendar className="size-3.5" />,
};

const kindLabel: Record<PendingListingRow['kind'], string> = {
  SPACE: 'Space',
  PROGRAM: 'Program',
  EVENT: 'Event',
};

export function ListingsApprovalTable({
  initial,
}: {
  initial: PendingListingRow[];
}) {
  const locale = useLocale() as Locale;
  const [rows, setRows] = useState(initial);
  const [resolved, setResolved] = useState<{ id: string; outcome: 'approved' | 'rejected' } | null>(null);

  function decide(id: string, outcome: 'approved' | 'rejected') {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setResolved({ id, outcome });
  }

  return (
    <div className="space-y-4">
      {resolved && (
        <div
          role="status"
          className={
            resolved.outcome === 'approved'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800'
              : 'rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'
          }
        >
          Listing {resolved.outcome}.{' '}
          <button
            type="button"
            onClick={() => setResolved(null)}
            className="font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState
              title="Inbox zero"
              description="No listings are waiting for review right now."
              icon={<Check className="size-5 text-emerald-600" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Listing</TableHead>
                    <TableHead className="hidden sm:table-cell">Submitted by</TableHead>
                    <TableHead className="hidden md:table-cell">City</TableHead>
                    <TableHead className="hidden md:table-cell">Submitted</TableHead>
                    <TableHead className="hidden sm:table-cell text-end">Price</TableHead>
                    <TableHead className="w-44 text-end">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.title}</div>
                        <Badge variant="outline" className="mt-1 gap-1">
                          {kindIcon[r.kind]}
                          {kindLabel[r.kind]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm">{r.incubator}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm capitalize text-muted-foreground">
                        {r.city}
                      </TableCell>
                      <TableCell className="hidden md:table-cell whitespace-nowrap text-xs text-muted-foreground">
                        {formatRelativeTime(r.submittedAt, locale)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-end tabular-nums">
                        {r.price === 0 ? (
                          <Badge variant="success">Free</Badge>
                        ) : (
                          formatCurrency(r.price, locale)
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="flex flex-col gap-1.5 sm:flex-row sm:justify-end sm:gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => decide(r.id, 'rejected')}
                          >
                            <X />
                            Reject
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => decide(r.id, 'approved')}
                          >
                            <Check />
                            Approve
                          </Button>
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
    </div>
  );
}
