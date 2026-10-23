'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type State = 'PENDING' | 'APPROVED' | 'REJECTED';

interface Item {
  userId: string;
  fullName: string;
  email: string;
  status: string;
  documentKind: string;
  submittedAt: string;
  extracted: {
    documentType: string;
    holderName: string | null;
    documentNumber: string | null;
    expiryDate: string | null;
    legible: boolean;
    confidence: number;
  } | null;
  review: { state: State; by: string; reasons: string[]; at: string };
}

/** Business-document queue: what the reader saw, why it stopped, and the decision. */
export function LegalReviewsManager() {
  const t = useTranslations('admin.legalReviews');
  const [state, setState] = useState<State>('PENDING');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    setItems(null);
    const res = await fetch(`/api/admin/legal-reviews?state=${state}`, { cache: 'no-store' });
    if (!res.ok) { setError(true); return; }
    setItems(((await res.json()) as { items: Item[] }).items);
  }, [state]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist">
        {(['PENDING', 'APPROVED', 'REJECTED'] as State[]).map((s) => (
          <Button key={s} size="sm" role="tab" aria-selected={state === s} variant={state === s ? 'default' : 'outline'} onClick={() => setState(s)}>
            {t(`tab.${s}`)}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{t('loadError')}</p>}
      {items && items.length === 0 && <p className="text-sm text-muted-foreground">{t('empty')}</p>}
      <div className="space-y-3">
        {items?.map((item) => <ReviewRow key={item.userId} item={item} onDone={load} />)}
      </div>
    </div>
  );
}

function ReviewRow({ item, onDone }: { item: Item; onDone: () => void }) {
  const t = useTranslations('admin.legalReviews');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    if (decision === 'REJECTED' && !note.trim()) { setErr(t('noteRequired')); return; }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/admin/legal-reviews/${encodeURIComponent(item.userId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, ...(note.trim() ? { note: note.trim() } : {}) }),
    });
    setBusy(false);
    if (!res.ok) { setErr(t('decideError')); return; }
    onDone();
  }

  const x = item.extracted;
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">{item.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{item.email}</p>
          </div>
          <a
            href={`/api/admin/legal-reviews/${encodeURIComponent(item.userId)}/document`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <ExternalLink className="size-4" /> {t('openDocument')}
          </a>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <Row label={t('declared')} value={`${t(`status.${item.status}`)} · ${t(`kind.${item.documentKind}`)}`} />
          <Row label={t('read.type')} value={x ? t(`kind.${x.documentType}`) : '—'} />
          <Row label={t('read.name')} value={x?.holderName ?? '—'} />
          <Row label={t('read.number')} value={x?.documentNumber ?? '—'} />
          <Row label={t('read.expiry')} value={x?.expiryDate ?? '—'} />
          <Row label={t('read.confidence')} value={x ? `${Math.round(x.confidence * 100)} %${x.legible ? '' : ` · ${t('read.illegible')}`}` : '—'} />
        </dl>
        {item.review.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.review.reasons.map((r) => (
              <Badge key={r} variant={item.review.state === 'PENDING' ? 'warning' : 'default'}>
                {item.review.by === 'AUTO' ? t(`reason.${r}`) : r}
              </Badge>
            ))}
          </div>
        )}
        {item.review.state === 'PENDING' && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} className="text-base sm:text-sm" aria-label={t('notePlaceholder')} />
            <div className="flex gap-2">
              <Button size="sm" loading={busy} onClick={() => decide('APPROVED')}>{t('approve')}</Button>
              <Button size="sm" variant="outline" className={cn('text-destructive')} disabled={busy} onClick={() => decide('REJECTED')}>{t('reject')}</Button>
            </div>
          </div>
        )}
        {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}
