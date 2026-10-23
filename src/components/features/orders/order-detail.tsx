'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, CreditCard, MessageSquare, Star, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { OrderView } from '@/server/orders/service';

const STEPS = ['AWAITING_DEPOSIT', 'IN_PROGRESS', 'DELIVERED', 'COMPLETED'] as const;
const KNOWN_ERRORS = ['INSUFFICIENT_FUNDS', 'NO_WALLET', 'WALLET_FROZEN', 'NOT_PAYABLE', 'WRONG_STATUS', 'ALREADY_REVIEWED'];

interface Props {
  initial: OrderView;
  /** Founder only: current wallet balance. */
  walletBalance: number | null;
  messagesPath: string;
  walletPath: string;
}

/** One order: where it stands, and the one thing to do next. */
export function OrderDetail({ initial, walletBalance, messagesPath, walletPath }: Props) {
  const t = useTranslations('orders');
  const locale = useLocale() as Locale;
  const [o, setO] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const money = (n: number) => formatCurrency(n, locale);
  const step = o.status === 'CANCELLED' ? -1 : STEPS.indexOf(o.status as (typeof STEPS)[number]);

  async function act(action: 'PAY_WALLET' | 'DELIVER' | 'CANCEL') {
    if (action === 'CANCEL' && !window.confirm(t('confirmCancel'))) return;
    setBusy(action);
    setErr(null);
    const res = await fetch(`/api/orders/${o.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    setBusy(null);
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';
      setErr(t(`errors.${KNOWN_ERRORS.includes(code) ? code : 'GENERIC'}`));
      return;
    }
    setO((await res.json()) as OrderView);
  }

  const due = o.status === 'AWAITING_DEPOSIT' ? 'DEPOSIT' : o.status === 'DELIVERED' ? 'BALANCE' : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground"><bdi>{o.number}</bdi> · <bdi>{formatDate(o.createdAt, locale, { dateStyle: 'medium' })}</bdi></p>
        <h1 className="text-xl font-semibold" dir="auto">{o.title}</h1>
        <p className="text-sm text-muted-foreground">{t(o.role === 'FOUNDER' ? 'withFreelancer' : 'forClient', { name: o.other.name })}</p>
      </header>

      {o.status === 'CANCELLED' ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t('cancelled')}</p>
      ) : (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={t('progress')}>
          {STEPS.map((s, i) => (
            <li key={s} className="space-y-1.5">
              <span className={cn('block h-1.5 rounded-full', i <= step ? 'bg-primary' : 'bg-muted')} />
              <span className={cn('block text-[11px] leading-tight', i === step ? 'font-semibold' : 'text-muted-foreground')}>{t(`status.${s}`)}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm sm:p-4">
        <Amount label={t('deposit')} value={money(o.depositAmount)} done={Boolean(o.depositPaidAt)} />
        <Amount label={t('balance')} value={money(o.balanceAmount)} done={Boolean(o.completedAt)} />
        <Amount label={t('total')} value={money(o.total)} />
      </section>

      {o.role === 'FREELANCER' && o.netToFreelancer !== null && (
        <p className="text-sm text-muted-foreground">{t('netNote', { net: money(o.netToFreelancer), percent: o.commissionPercent ?? 0 })}</p>
      )}

      {/* ── Founder: pay what is due ── */}
      {o.role === 'FOUNDER' && due && o.dueGross !== null && (
        <section className="space-y-3 rounded-xl border-2 border-primary-200 p-4">
          <h2 className="font-semibold">{t(due === 'DEPOSIT' ? 'payDeposit' : 'payBalance')}</h2>
          <p className="text-2xl font-bold tabular-nums">{money(o.dueGross)}</p>
          <p className="text-xs text-muted-foreground">{t('feeNote')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" loading={busy === 'PAY_WALLET'} disabled={walletBalance !== null && walletBalance < o.dueGross} onClick={() => void act('PAY_WALLET')}>
              <Wallet className="size-4" />{t('payWallet')}
            </Button>
            {o.payPath && <Button asChild variant="outline"><Link href={o.payPath}><CreditCard className="size-4" />{t('payCard')}</Link></Button>}
          </div>
          {walletBalance !== null && (
            <p className="text-xs text-muted-foreground">
              {t('walletBalance', { amount: money(walletBalance) })}
              {walletBalance < o.dueGross && <> · <Link href={walletPath} className="font-medium text-primary hover:underline">{t('topUp')}</Link></>}
            </p>
          )}
        </section>
      )}

      {/* ── Freelancer: deliver ── */}
      {o.role === 'FREELANCER' && o.status === 'IN_PROGRESS' && (
        <section className="space-y-3 rounded-xl border-2 border-primary-200 p-4">
          <h2 className="font-semibold">{t('deliverTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('deliverBody')}</p>
          <Button type="button" loading={busy === 'DELIVER'} onClick={() => void act('DELIVER')}><Check className="size-4" />{t('markDelivered')}</Button>
        </section>
      )}
      {o.role === 'FREELANCER' && o.status === 'AWAITING_DEPOSIT' && <p className="text-sm text-muted-foreground">{t('waitDeposit')}</p>}
      {o.role === 'FREELANCER' && o.status === 'DELIVERED' && <p className="text-sm text-muted-foreground">{t('waitBalance')}</p>}

      {/* ── Founder: review ── */}
      {o.role === 'FOUNDER' && o.status === 'COMPLETED' && !o.review && <ReviewForm id={o.id} onDone={(review) => setO((x) => ({ ...x, review }))} />}
      {o.review && (
        <section className="space-y-1 rounded-lg border p-4 text-sm">
          <Stars value={o.review.rating} />
          {o.review.comment && <p className="whitespace-pre-line" dir="auto">{o.review.comment}</p>}
        </section>
      )}

      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {o.conversationId && (
          <Button asChild variant="outline" size="sm"><Link href={`${messagesPath}?c=${o.conversationId}`}><MessageSquare className="size-4" />{t('conversation')}</Link></Button>
        )}
        {o.status === 'AWAITING_DEPOSIT' && (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" loading={busy === 'CANCEL'} onClick={() => void act('CANCEL')}>{t('cancel')}</Button>
        )}
      </div>
      {(o.status === 'IN_PROGRESS' || o.status === 'DELIVERED') && <p className="text-xs text-muted-foreground">{t('supportNote')}</p>}
    </div>
  );
}

function Amount({ label, value, done }: { label: string; value: string; done?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="flex items-center gap-1 truncate font-semibold tabular-nums">{done && <Check className="size-3.5 shrink-0 text-emerald-600" />}{value}</p>
    </div>
  );
}

export function Stars({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  return (
    <span className="inline-flex" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn(size === 'sm' ? 'size-3.5' : 'size-5', i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
      ))}
    </span>
  );
}

function ReviewForm({ id, onDone }: { id: string; onDone: (r: NonNullable<OrderView['review']>) => void }) {
  const t = useTranslations('orders');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/orders/${id}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, comment: comment.trim() || null }) });
    setBusy(false);
    if (!res.ok) { setErr(t('errors.GENERIC')); return; }
    onDone(((await res.json()) as { review: NonNullable<OrderView['review']> }).review);
  }
  return (
    <section className="space-y-3 rounded-xl border-2 border-amber-200 p-4">
      <h2 className="font-semibold">{t('reviewTitle')}</h2>
      <div className="flex gap-1" role="radiogroup" aria-label={t('reviewTitle')}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={rating === i} aria-label={`${i}/5`} onClick={() => setRating(i)} className="p-1">
            <Star className={cn('size-7', i <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
          </button>
        ))}
      </div>
      <Textarea rows={3} maxLength={1000} value={comment} placeholder={t('reviewPlaceholder')} className="text-base sm:text-sm" onChange={(e) => setComment(e.target.value)} />
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <Button type="button" loading={busy} disabled={rating === 0} onClick={() => void send()}>{t('reviewSend')}</Button>
    </section>
  );
}
