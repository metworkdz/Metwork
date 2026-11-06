'use client';

/**
 * Incubator seats: a quote that follows the bulk tiers as you type, buying
 * from the incubator wallet, and assigning each seat to a member by email or
 * phone. Prices shown are computed with the same function as the server's.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, UserMinus, UserPlus } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { ACADEMY_MAX_SEAT_MONTHS, ACADEMY_MAX_SEATS, quoteSeats, type SeatTier } from '@/lib/academy';
import { formatDzd } from '../format';

interface Batch {
  id: string; seats: number; months: number; startAt: string; endAt: string; unitPriceDzd: number; discountRate: number; amountDzd: number;
  currentMonth: number | null;
  seatList: { id: string; holder: { name: string; contact: string } | null }[];
}

export function SeatsManager({ initialBatches, monthlyPriceDzd, tiers, walletBalance }: { initialBatches: Batch[]; monthlyPriceDzd: number; tiers: SeatTier[]; walletBalance: number }) {
  const t = useTranslations('academyIncubator');
  const tm = useTranslations('academy');
  const locale = useLocale();
  const money = (n: number) => tm('money', { price: formatDzd(n, locale) });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-DZ', { day: 'numeric', month: 'long', year: 'numeric' });

  const [batches, setBatches] = useState(initialBatches);
  const [seats, setSeats] = useState(10);
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(walletBalance);
  // One key per purchase: a double click never pays twice; a new key after each purchase.
  const newKey = () => `seats-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const [clientReference, setClientReference] = useState(newKey);
  const quote = quoteSeats(seats, months, monthlyPriceDzd, tiers);
  const valid = seats >= 1 && seats <= ACADEMY_MAX_SEATS && months >= 1 && months <= ACADEMY_MAX_SEAT_MONTHS;

  async function reload() {
    const res = await apiClient.get<{ batches: Batch[]; walletBalance: number }>('/incubator/academy/seats');
    setBatches(res.batches);
    setBalance(res.walletBalance);
  }

  async function buy() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/incubator/academy/seats', { seats, months, clientReference });
      setClientReference(newKey());
      await reload();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['INSUFFICIENT_FUNDS', 'WALLET_FROZEN', 'INVALID_QUANTITY', 'RATE_LIMITED'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('buyTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('buyDesc', { price: money(monthlyPriceDzd) })}</p>
        <ul className="flex flex-wrap gap-2 text-xs">
          {tiers.map((tier) => (
            <li key={tier.minSeats} className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">{t('tier', { seats: tier.minSeats, percent: Math.round(tier.discountRate * 100) })}</li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="seats">{t('seats')}</Label>
            <Input id="seats" type="number" inputMode="numeric" min={1} max={ACADEMY_MAX_SEATS} value={seats} onChange={(e) => setSeats(Math.floor(Number(e.target.value) || 0))} className="text-base sm:text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="months">{t('months')}</Label>
            <Input id="months" type="number" inputMode="numeric" min={1} max={ACADEMY_MAX_SEAT_MONTHS} value={months} onChange={(e) => setMonths(Math.floor(Number(e.target.value) || 0))} className="text-base sm:text-sm" />
          </div>
        </div>
        {valid && (
          <dl className="space-y-1 rounded-xl bg-muted/50 p-3 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">{t('unit')}</dt><dd className="tabular-nums">{money(quote.unitPriceDzd)}{quote.discountRate > 0 && <span className="ms-1 text-xs text-primary">(−{Math.round(quote.discountRate * 100)} %)</span>}</dd></div>
            <div className="flex justify-between font-display text-base font-extrabold"><dt>{t('total')}</dt><dd className="tabular-nums">{money(quote.amountDzd)}</dd></div>
            <div className="flex justify-between text-xs text-muted-foreground"><dt>{t('wallet')}</dt><dd className="tabular-nums">{money(balance)}</dd></div>
          </dl>
        )}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy || !valid || balance < quote.amountDzd} onClick={buy}>{busy && <Loader2 className="me-1 size-4 animate-spin" />}{t('buy', { total: money(quote.amountDzd) })}</Button>
          {valid && balance < quote.amountDzd && <Link href="/dashboard/incubator/wallet" className="text-sm font-semibold text-primary hover:underline">{t('topUp')}</Link>}
        </div>
        <p className="text-xs text-muted-foreground">{t('rules')}</p>
      </section>

      {batches.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : batches.map((b) => (
        <section key={b.id} className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-base font-extrabold">{t('batchTitle', { seats: b.seats, months: b.months })}</h2>
            <p className="text-xs text-muted-foreground">{b.currentMonth === null ? t('batchEnded', { date: day(b.endAt) }) : t('batchUntil', { date: day(b.endAt) })}</p>
          </div>
          <ul className="divide-y divide-border">
            {b.seatList.map((seat, i) => <SeatRow key={seat.id} batchId={b.id} seat={seat} n={i + 1} ended={b.currentMonth === null} onDone={reload} />)}
          </ul>
        </section>
      ))}
    </div>
  );
}

function SeatRow({ batchId, seat, n, ended, onDone }: { batchId: string; seat: Batch['seatList'][number]; n: number; ended: boolean; onDone(): Promise<void> }) {
  const t = useTranslations('academyIncubator');
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string | null) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.put(`/incubator/academy/seats/${batchId}/${seat.id}`, { contact: value });
      setEditing(false);
      setContact('');
      await onDone();
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['MEMBER_NOT_FOUND', 'NOT_A_LEARNER', 'ALREADY_SEATED', 'ENDED', 'RATE_LIMITED'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  return (
    <li className="py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-14 shrink-0 text-xs font-bold text-muted-foreground">{t('seatN', { n })}</span>
        <span className="min-w-0 flex-1">
          {seat.holder ? (<><span dir="auto" className="font-semibold">{seat.holder.name}</span> <span dir="ltr" className="whitespace-nowrap text-muted-foreground">· {seat.holder.contact}</span></>) : <span className="text-muted-foreground">{t('free')}</span>}
        </span>
        {!ended && !editing && (
          <span className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}><UserPlus className="me-1 size-4" />{seat.holder ? t('reassign') : t('assign')}</Button>
            {seat.holder && <Button size="sm" variant="ghost" disabled={busy} onClick={() => save(null)} aria-label={t('unassign')}><UserMinus className="size-4" /></Button>}
          </span>
        )}
      </div>
      {editing && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input dir="ltr" value={contact} placeholder={t('contactPlaceholder')} onChange={(e) => setContact(e.target.value)} className="text-base sm:text-sm" />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || contact.trim().length < 5} onClick={() => save(contact.trim())}>{busy && <Loader2 className="me-1 size-4 animate-spin" />}{t('confirm')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('cancel')}</Button>
          </div>
        </div>
      )}
      {editing && seat.holder && <p className="mt-1 text-xs text-muted-foreground">{t('reassignHint')}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
    </li>
  );
}
