'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BadgeCheck, MapPin, Search, Sparkles, Star, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MemberBadge } from '@/components/shared/member-badge';
import { Link } from '@/i18n/routing';
import { algerianCities, getCityName } from '@/config/cities';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { FreelancerCard as Card } from '@/server/hiring/directory';

interface Props {
  initial: Card[];
  total: number;
}

interface Match { card: Card; reasons: string[] }

/** The hiring tab: describe a need to the AI, or browse everyone with filters. */
export function HiringTab({ initial, total: initialTotal }: Props) {
  const t = useTranslations('hiring');
  const locale = useLocale() as Locale;
  const [need, setNeed] = useState('');
  const [matching, setMatching] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [matchMsg, setMatchMsg] = useState<string | null>(null);

  const [list, setList] = useState(initial);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [remote, setRemote] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(false);

  async function match() {
    setMatching(true);
    setMatchMsg(null);
    const res = await fetch('/api/hiring/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: need, lang: locale }),
    });
    setMatching(false);
    if (!res.ok) {
      setMatches(null);
      setMatchMsg(res.status === 429 ? t('matchRate') : t('matchError'));
      return;
    }
    const body = (await res.json()) as { matches: Match[]; reason?: string };
    setMatches(body.matches);
    if (!body.matches.length) setMatchMsg(body.reason === 'NOT_A_NEED' ? t('matchNotANeed') : t('matchNone'));
  }

  async function browse(offset = 0) {
    setLoading(true);
    const sp = new URLSearchParams();
    if (q.trim()) sp.set('q', q.trim());
    if (city) sp.set('city', city);
    if (Number(maxPrice) > 0) sp.set('maxPrice', String(Number(maxPrice)));
    if (remote) sp.set('remote', '1');
    if (verified) sp.set('verified', '1');
    sp.set('offset', String(offset));
    const res = await fetch(`/api/hiring/freelancers?${sp.toString()}`);
    setLoading(false);
    if (!res.ok) return;
    const body = (await res.json()) as { total: number; freelancers: Card[] };
    setTotal(body.total);
    setList((l) => (offset ? [...l, ...body.freelancers] : body.freelancers));
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3 rounded-xl border-2 border-primary-200 bg-primary-50/40 p-4 dark:bg-primary/10 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />{t('aiTitle')}</h2>
        <label htmlFor="need" className="sr-only">{t('aiTitle')}</label>
        <Textarea
          id="need"
          rows={3}
          maxLength={1500}
          value={need}
          placeholder={t('aiPlaceholder')}
          className="bg-background text-base sm:text-sm"
          onChange={(e) => setNeed(e.target.value)}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{t('aiHint')}</p>
          <Button type="button" loading={matching} disabled={need.trim().length < 10} onClick={() => void match()} className="w-full sm:w-auto">
            <Sparkles className="size-4" />{t('aiFind')}
          </Button>
        </div>
        {matchMsg && <p role="status" className="text-sm text-muted-foreground">{matchMsg}</p>}
        {matches && matches.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">{t('aiResults', { count: matches.length })}</p>
            <div className="grid gap-3 md:grid-cols-3">
              {matches.map((m, i) => <FreelancerTile key={m.card.id} card={m.card} reasons={m.reasons} top={i === 0} />)}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('browseTitle')}</h2>
          <span className="text-xs text-muted-foreground">{t('count', { count: total })}</span>
        </div>
        <form
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_160px_auto]"
          onSubmit={(e) => { e.preventDefault(); void browse(0); }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label={t('search')} placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} className="ps-9 text-base sm:text-sm" />
          </div>
          <select aria-label={t('city')} value={city} onChange={(e) => setCity(e.target.value)} className="h-10 rounded-md border bg-background px-3 text-base sm:text-sm">
            <option value="">{t('allCities')}</option>
            {algerianCities.map((c) => <option key={c.code} value={c.code}>{getCityName(c.code, locale)}</option>)}
          </select>
          <Input aria-label={t('maxPrice')} inputMode="numeric" dir="ltr" placeholder={t('maxPrice')} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/\D/g, '').slice(0, 9))} className="text-base sm:text-sm" />
          <Button type="submit" loading={loading}>{t('apply')}</Button>
          <div className="flex flex-wrap gap-4 text-sm sm:col-span-2 lg:col-span-4">
            <label className="flex min-h-[36px] items-center gap-2"><input type="checkbox" className="size-4" checked={remote} onChange={(e) => setRemote(e.target.checked)} />{t('remoteOnly')}</label>
            <label className="flex min-h-[36px] items-center gap-2"><input type="checkbox" className="size-4" checked={verified} onChange={(e) => setVerified(e.target.checked)} />{t('verifiedOnly')}</label>
          </div>
        </form>
        {list.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((c) => <FreelancerTile key={c.id} card={c} />)}
          </div>
        )}
        {list.length < total && (
          <div className="text-center"><Button type="button" variant="outline" loading={loading} onClick={() => void browse(list.length)}>{t('more')}</Button></div>
        )}
      </section>
    </div>
  );
}

export function FreelancerTile({ card, reasons, top }: { card: Card; reasons?: string[]; top?: boolean }) {
  const t = useTranslations('hiring');
  const locale = useLocale() as Locale;
  const price = card.fromPrice ?? card.dayRate;
  const initials = card.name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return (
    <Link
      href={`/dashboard/entrepreneur/hire/${card.id}`}
      className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary-300', top && 'border-primary-300 ring-2 ring-primary-100')}
    >
      <div className="flex items-start gap-3">
        {card.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar, sized here
          <img src={card.avatarUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-50 font-semibold text-primary-700">{initials}</span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{card.name}</span>
            {card.badge && <MemberBadge badge={card.badge} />}
            {card.verified && !card.badge && <BadgeCheck className="size-4 shrink-0 text-sky-600" aria-label={t('verified')} />}
          </p>
          <p className="line-clamp-2 text-sm text-muted-foreground">{card.headline}</p>
          {card.rating !== null && (
            <p className="mt-0.5 flex items-center gap-1 text-xs"><Star className="size-3.5 fill-amber-400 text-amber-400" /><span className="font-medium">{card.rating}</span><span className="text-muted-foreground">({card.reviewCount})</span></p>
          )}
        </div>
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {card.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{getCityName(card.city, locale)}</span>}
        {card.remote && <span className="inline-flex items-center gap-1"><Wifi className="size-3.5" />{t('remote')}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {card.skills.slice(0, 4).map((s) => <span key={s} className="rounded-full border px-2 py-0.5 text-xs">{s}</span>)}
      </div>
      {reasons && reasons.length > 0 && (
        <div className="rounded-lg border border-dashed border-primary-200 bg-background p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary-700">{t('why')}</p>
          <ul className="mt-1 space-y-0.5 text-xs">{reasons.map((r) => <li key={r}>• {r}</li>)}</ul>
        </div>
      )}
      <p className="mt-auto text-sm">
        {price ? t(card.fromPrice ? 'fromPrice' : 'dayRate', { price: formatCurrency(price, locale) }) : <span className="text-muted-foreground">{t('priceOnRequest')}</span>}
      </p>
    </Link>
  );
}
