'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Clock, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Link } from '@/i18n/routing';
import { formatCurrency } from '@/lib/format';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';
import type { Locale } from '@/i18n/config';

export interface Gig {
  id: string;
  title: string;
  description: string;
  price: number;
  deliveryDays: number;
  revisions: number;
  isActive: boolean;
}

/** A freelancer's gigs: what they sell at a fixed price. */
export function GigsManager({ initial, activeLimit }: { initial: Gig[]; activeLimit: number | null }) {
  const t = useTranslations('freelancer.gigs');
  const locale = useLocale() as Locale;
  const [gigs, setGigs] = useState(initial);
  const [editing, setEditing] = useState<Gig | 'new' | null>(null);
  const active = gigs.filter((g) => g.isActive).length;

  async function remove(g: Gig) {
    const res = await fetch(`/api/freelancer/gigs/${g.id}`, { method: 'DELETE' });
    if (res.ok) setGigs((gs) => gs.filter((x) => x.id !== g.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {activeLimit === null ? t('activeUnlimited', { count: active }) : t('activeLimited', { count: active, limit: activeLimit })}
          {activeLimit !== null && (
            <> · <Link href="/dashboard/freelancer/membership" className="font-medium text-primary hover:underline">{t('upgrade')}</Link></>
          )}
        </p>
        <Button type="button" onClick={() => setEditing('new')}><Plus className="size-4" />{t('new')}</Button>
      </div>
      {gigs.length === 0 && <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gigs.map((g) => (
          <Card key={g.id} className={g.isActive ? '' : 'opacity-70'}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 font-semibold leading-snug">{g.title}</p>
                <Badge variant={g.isActive ? 'success' : 'default'}>{g.isActive ? t('active') : t('draft')}</Badge>
              </div>
              {g.description && <p className="line-clamp-3 text-sm text-muted-foreground">{g.description}</p>}
              <p className="text-xl font-bold tabular-nums">{formatCurrency(g.price, locale)}</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{t('days', { count: g.deliveryDays })}</span>
                <span className="inline-flex items-center gap-1"><RefreshCw className="size-3.5" />{t('revisions', { count: g.revisions })}</span>
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(g)}><Pencil className="size-4" />{t('edit')}</Button>
                <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => void remove(g)}><Trash2 className="size-4" />{t('delete')}</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && (
        <GigDialog
          gig={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setGigs((gs) => (gs.some((x) => x.id === saved.id) ? gs.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...gs]));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function GigDialog({ gig, onClose, onSaved }: { gig: Gig | null; onClose: () => void; onSaved: (g: Gig) => void }) {
  const t = useTranslations('freelancer.gigs');
  const [title, setTitle] = useState(gig?.title ?? '');
  const [description, setDescription] = useState(gig?.description ?? '');
  const [price, setPrice] = useState(gig ? String(gig.price) : '');
  const [days, setDays] = useState(gig ? String(gig.deliveryDays) : '7');
  const [revisions, setRevisions] = useState(gig ? String(gig.revisions) : '2');
  const [isActive, setIsActive] = useState(gig?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    const res = await fetch(gig ? `/api/freelancer/gigs/${gig.id}` : '/api/freelancer/gigs', {
      method: gig ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), description: description.trim(), price: Number(price), deliveryDays: Number(days), revisions: Number(revisions), isActive }),
    });
    setBusy(false);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
      setErr(code === 'PLAN_LIMIT_REACHED' ? t('limitReached') : t('saveError'));
      return;
    }
    onSaved((await res.json()) as Gig);
  }

  const num = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={SHEET_CONTENT_CLASS}>
        <DialogHeader><DialogTitle>{gig ? t('edit') : t('new')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="g-title" className="text-sm font-medium">{t('title')}</label>
            <Input id="g-title" className="mt-1.5 text-base sm:text-sm" value={title} maxLength={100} placeholder={t('titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="g-desc" className="text-sm font-medium">{t('description')}</label>
            <Textarea id="g-desc" rows={4} className="mt-1.5 text-base sm:text-sm" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="g-price" className="text-sm font-medium">{t('price')}</label>
              <Input id="g-price" inputMode="numeric" dir="ltr" className="mt-1.5 text-base tabular-nums sm:text-sm" value={price} onChange={(e) => setPrice(num(e.target.value, 9))} />
            </div>
            <div>
              <label htmlFor="g-days" className="text-sm font-medium">{t('deliveryDays')}</label>
              <Input id="g-days" inputMode="numeric" dir="ltr" className="mt-1.5 text-base tabular-nums sm:text-sm" value={days} onChange={(e) => setDays(num(e.target.value, 3))} />
            </div>
            <div>
              <label htmlFor="g-rev" className="text-sm font-medium">{t('revisionsLabel')}</label>
              <Input id="g-rev" inputMode="numeric" dir="ltr" className="mt-1.5 text-base tabular-nums sm:text-sm" value={revisions} onChange={(e) => setRevisions(num(e.target.value, 2))} />
            </div>
          </div>
          <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 rounded border-input" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            {t('activeToggle')}
          </label>
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
          <Button type="button" className="w-full" loading={busy} disabled={title.trim().length < 3 || Number(price) < 500 || Number(days) < 1} onClick={() => void save()}>{t('save')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
