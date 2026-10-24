'use client';

/**
 * The admin's queue of consultant programs: approve (it goes on /programs) or
 * refuse with a reason the consultant will read.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Check, MapPin, Users, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProgramReviewView {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  consultant: string;
  consultantEmail: string | null;
  city: string;
  type: string;
  price: number;
  seatsTotal: number;
  startDate: string | null;
  endDate: string | null;
  visibility: 'PUBLIC' | 'UNLISTED';
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
}

type Filter = 'PENDING' | 'APPROVED' | 'REJECTED';

const day = (iso: string) => new Date(iso).toLocaleDateString('fr-DZ', { timeZone: 'Africa/Algiers' });

export function ProgramApprovalsManager({ initial }: { initial: ProgramReviewView[] }) {
  const t = useTranslations('admin.programApprovals');
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/programs/${id}/review`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reason: decision === 'REJECT' ? reason : null }),
      });
      const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!res.ok) { setError(body?.error?.message ?? t('failed')); return; }
      setItems((list) => list.map((p) => (p.id === id
        ? { ...p, status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', rejectionReason: decision === 'REJECT' ? reason.trim() : null }
        : p)));
      setRejecting(null);
      setReason('');
    } finally {
      setBusy(null);
    }
  }

  const shown = items.filter((p) => p.status === filter);

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="tablist">
        {(['PENDING', 'APPROVED', 'REJECTED'] as Filter[]).map((f) => (
          <button
            key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn(
              'min-h-9 rounded-md px-3.5 text-sm font-medium transition-colors',
              filter === f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`tab${f}`)} ({items.filter((p) => p.status === f).length})
          </button>
        ))}
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {shown.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t(`empty${filter}`)}</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((p) => (
            <li key={p.id} className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
              {p.imageUrl
                // eslint-disable-next-line @next/next/no-img-element -- program cover, as on the public card
                ? <img src={p.imageUrl} alt="" className="aspect-video w-full rounded-md object-cover sm:aspect-square" />
                : <div className="hidden rounded-md bg-muted sm:block" />}
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p dir="auto" className="font-semibold leading-snug">{p.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {t('by', { name: p.consultant })}{p.consultantEmail ? ` · ${p.consultantEmail}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant="outline">{p.visibility === 'UNLISTED' ? t('unlisted') : t('public')}</Badge>
                    <Badge variant="outline">{p.price > 0 ? `${p.price.toLocaleString('fr-DZ')} DA` : t('free')}</Badge>
                  </div>
                </div>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />
                    {p.startDate ? `${day(p.startDate)}${p.endDate && p.endDate !== p.startDate ? ` → ${day(p.endDate)}` : ''}` : t('datesTbc')}
                  </span>
                  {p.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{p.city}</span>}
                  <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{t('seats', { count: p.seatsTotal })}</span>
                  <span>{t('submitted', { date: day(p.createdAt) })}</span>
                </p>
                <p dir="auto" className="line-clamp-3 whitespace-pre-line text-sm">{p.description}</p>
                {p.status === 'REJECTED' && p.rejectionReason && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{t('reasonShown', { reason: p.rejectionReason })}</p>
                )}

                {rejecting === p.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
                      aria-label={t('reasonLabel')} placeholder={t('reasonPlaceholder')}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" disabled={!reason.trim()} loading={busy === p.id} onClick={() => void decide(p.id, 'REJECT')}>{t('confirmReject')}</Button>
                      <Button size="sm" variant="outline" onClick={() => { setRejecting(null); setReason(''); }}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {p.status !== 'APPROVED' && (
                      <Button size="sm" loading={busy === p.id} onClick={() => void decide(p.id, 'APPROVE')}>
                        <Check className="size-4" /> {t('approve')}
                      </Button>
                    )}
                    {p.status !== 'REJECTED' && (
                      <Button size="sm" variant="outline" onClick={() => { setRejecting(p.id); setReason(''); }}>
                        <X className="size-4" /> {t('reject')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
