'use client';

/**
 * Investor view of their meeting requests. Status filter is local; the
 * accept/decline/reschedule actions are stubbed pending the meetings API.
 */
import { useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { CalendarClock, Check, MessageSquareText, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatDate, formatRelativeTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { DemoMeetingRequest, MeetingStatus } from '@/lib/demo-data';

const ALL = 'all';

const statusVariant: Record<MeetingStatus, React.ComponentProps<typeof Badge>['variant']> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  DECLINED: 'danger',
  COMPLETED: 'default',
};

const statusLabel: Record<MeetingStatus, string> = {
  PENDING: 'Pending',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  COMPLETED: 'Completed',
};

export function MeetingRequestsList({
  initial,
}: {
  initial: DemoMeetingRequest[];
}) {
  const locale = useLocale() as Locale;
  const [requests, setRequests] = useState(initial);
  const [filter, setFilter] = useState<MeetingStatus | typeof ALL>(ALL);

  const filtered = useMemo(
    () => (filter === ALL ? requests : requests.filter((r) => r.status === filter)),
    [requests, filter],
  );

  function setStatus(id: string, status: MeetingStatus) {
    setRequests((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground">Filter:</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as MeetingStatus | typeof ALL)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="ACCEPTED">Accepted</SelectItem>
            <SelectItem value="DECLINED">Declined</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <InlineEmptyState
            title="No meeting requests"
            description="When you request a meeting from the marketplace, it will appear here."
            icon={<CalendarClock className="size-5 text-muted-foreground" />}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{r.startupName}</h3>
                    <Badge variant={statusVariant[r.status]}>{statusLabel[r.status]}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Founder: {r.founderName} · Requested {formatRelativeTime(r.requestedAt, locale)}
                  </p>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs text-foreground">
                    <CalendarClock className="size-3.5 text-muted-foreground" />
                    Preferred: {formatDate(r.preferredAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <p className="mt-3 inline-flex items-start gap-2 text-sm text-muted-foreground">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0" />
                    <span>{r.message}</span>
                  </p>
                </div>
                {r.status === 'PENDING' && (
                  <div className="flex gap-2 md:flex-col">
                    <Button
                      size="sm"
                      type="button"
                      onClick={() => setStatus(r.id, 'ACCEPTED')}
                    >
                      <Check />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => setStatus(r.id, 'DECLINED')}
                    >
                      <X />
                      Decline
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
