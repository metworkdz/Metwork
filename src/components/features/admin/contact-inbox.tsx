'use client';

/**
 * Admin: contact submissions inbox.
 * Shows all messages from the contact form with a "Mark as handled" toggle.
 */
import { useState } from 'react';
import { CheckCheck, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { ContactSubmissionRecord } from '@/server/db/store';

async function patchSubmission(id: string, handled: boolean) {
  const res = await fetch(`/api/admin/contact/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ handled }),
  });
  if (!res.ok) throw new Error('Update failed');
}

type Filter = 'all' | 'unhandled' | 'handled';

export function ContactInbox({ initial }: { initial: ContactSubmissionRecord[] }) {
  const [items,  setItems]  = useState(initial);
  const [filter, setFilter] = useState<Filter>('unhandled');
  const [busy,   setBusy]   = useState<Record<string, boolean>>({});

  const visible = items.filter((item) => {
    if (filter === 'unhandled') return !item.handled;
    if (filter === 'handled')   return item.handled;
    return true;
  });

  async function toggle(id: string, next: boolean) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await patchSubmission(id, next);
      setItems((prev) => prev.map((i) => i.id === id ? { ...i, handled: next } : i));
    } catch { /* silent */ }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  }

  const unhandledCount = items.filter((i) => !i.handled).length;

  const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: 'unhandled', label: 'Unhandled' },
    { value: 'handled',   label: 'Handled' },
    { value: 'all',       label: 'All' },
  ];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 w-fit">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            {f.value === 'unhandled' && unhandledCount > 0 && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">({unhandledCount})</span>
            )}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Card>
          <InlineEmptyState
            title={filter === 'unhandled' ? 'Inbox zero' : 'No submissions'}
            description={
              filter === 'unhandled'
                ? 'All contact submissions have been handled.'
                : 'No contact submissions yet.'
            }
            icon={<Mail className="size-5 text-muted-foreground" />}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible
            .slice()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((item) => (
              <Card
                key={item.id}
                className={cn('border-border/60 transition-opacity', item.handled && 'opacity-60')}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{item.name}</p>
                        <a
                          href={`mailto:${item.email}`}
                          className="text-xs text-muted-foreground hover:underline"
                        >
                          {item.email}
                        </a>
                        {item.handled && (
                          <Badge variant="success" className="gap-1">
                            <CheckCheck className="size-3" /> Handled
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-foreground/80 whitespace-pre-wrap">{item.message}</p>
                      <p className="text-xs text-muted-foreground/60">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={item.handled ? 'outline' : 'default'}
                      className="shrink-0"
                      loading={busy[item.id]}
                      onClick={() => toggle(item.id, !item.handled)}
                    >
                      {item.handled ? 'Mark unhandled' : 'Mark handled'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
