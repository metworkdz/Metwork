'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Heart, MapPin, MessageSquare, Sparkles, Wifi, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MemberBadge } from '@/components/shared/member-badge';
import { Link, useRouter } from '@/i18n/routing';
import { getCityName } from '@/config/cities';
import { COFOUNDER_ROLES, COMMITMENTS, PITCH_MAX, PITCH_MIN, SECTORS, VALUE_KEYS, isComplete } from '@/lib/cofounder';
import { cn } from '@/lib/utils';
import { CofounderSwitch } from '@/components/features/cofounder/cofounder-switch';
import type { Locale } from '@/i18n/config';
import type { CofounderProfileRecord } from '@/server/db/store';
import type { CofounderCard, DeckView, MatchView } from '@/server/cofounder/service';

type Tab = 'deck' | 'matches' | 'profile';

interface Props {
  initialProfile: CofounderProfileRecord;
  basePath: string;
  membershipPath: string;
  phoneVerified: boolean;
}

/** Find my cofounder: today's deck, matches, and the profile behind both. */
export function CofounderTab({ initialProfile, basePath, membershipPath, phoneVerified }: Props) {
  const t = useTranslations('cofounder');
  const [profile, setProfile] = useState(initialProfile);
  const [tab, setTab] = useState<Tab>(isComplete(initialProfile) ? 'deck' : 'profile');
  return (
    <div className="space-y-5">
      <CofounderSwitch initial={profile.enabled} onChange={(enabled) => setProfile((p) => ({ ...p, enabled }))} />
      {!phoneVerified && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{t('phoneRequired')}</p>}

      <div role="tablist" className="grid grid-cols-3 rounded-lg bg-muted p-1 text-sm">
        {(['deck', 'matches', 'profile'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={cn('min-h-[40px] rounded-md font-medium transition-colors', tab === k ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'deck' && <Deck onEditProfile={() => setTab('profile')} onMatches={() => setTab('matches')} basePath={basePath} membershipPath={membershipPath} />}
      {tab === 'matches' && <Matches basePath={basePath} membershipPath={membershipPath} />}
      {tab === 'profile' && <ProfileForm initial={profile} onSaved={(p) => { setProfile(p); setTab('deck'); }} />}
    </div>
  );
}

/* ─────────────────────────── Deck ─────────────────────────── */

function Deck({ onEditProfile, onMatches, basePath, membershipPath }: { onEditProfile: () => void; onMatches: () => void; basePath: string; membershipPath: string }) {
  const t = useTranslations('cofounder');
  const [deck, setDeck] = useState<DeckView | null>(null);
  const [error, setError] = useState(false);
  const [leaving, setLeaving] = useState<'LIKE' | 'PASS' | null>(null);
  const [match, setMatch] = useState<MatchView | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/cofounder/deck', { cache: 'no-store' });
    if (!res.ok) { setError(true); return; }
    setDeck((await res.json()) as DeckView);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const current = deck?.cards[0];

  const decide = useCallback(async (decision: 'LIKE' | 'PASS') => {
    if (!current || leaving) return;
    setLeaving(decision);
    const res = await fetch('/api/cofounder/swipe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: current.id, decision }) });
    // Let the card fly out before the next one shows.
    await new Promise((r) => setTimeout(r, 250));
    setLeaving(null);
    if (!res.ok) { void load(); return; }
    const { match: m } = (await res.json()) as { match: MatchView | null };
    if (m) setMatch(m);
    setDeck((d) => (d ? { ...d, cards: d.cards.slice(1), used: d.used + 1 } : d));
  }, [current, leaving, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowRight') void decide(document.dir === 'rtl' ? 'PASS' : 'LIKE');
      if (e.key === 'ArrowLeft') void decide(document.dir === 'rtl' ? 'LIKE' : 'PASS');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide]);

  if (error) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('unavailable')}</p>;
  if (!deck) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (deck.state !== 'READY') {
    return (
      <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
        <p className="text-sm">{t(`state.${deck.state}`)}</p>
        {deck.state === 'NEEDS_PROFILE' && <Button type="button" onClick={onEditProfile}>{t('completeProfile')}</Button>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-4">
      {deck.likesWaiting > 0 && (
        <p className="flex items-center justify-center gap-2 rounded-full bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          <Heart className="size-4 fill-current" />{t('likesWaiting', { count: deck.likesWaiting })}
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">{t('today', { used: deck.used, total: deck.perDay })}</p>
      {current ? (
        <>
          <div className={cn('transition-all duration-200', leaving === 'LIKE' && 'translate-x-24 rotate-6 opacity-0 rtl:-translate-x-24 rtl:-rotate-6', leaving === 'PASS' && '-translate-x-24 -rotate-6 opacity-0 rtl:translate-x-24 rtl:rotate-6')}>
            <ProfileCard c={current} />
          </div>
          <div className="flex justify-center gap-6">
            <button type="button" aria-label={t('pass')} onClick={() => void decide('PASS')} disabled={Boolean(leaving)}
              className="flex size-16 items-center justify-center rounded-full border-2 bg-background text-rose-600 shadow-sm transition-transform active:scale-95">
              <X className="size-7" />
            </button>
            <button type="button" aria-label={t('like')} onClick={() => void decide('LIKE')} disabled={Boolean(leaving)}
              className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform active:scale-95">
              <Heart className="size-7" />
            </button>
          </div>
          <p className="text-center text-xs text-muted-foreground">{t('likeNote')}</p>
        </>
      ) : (
        <div className="space-y-3 rounded-xl border border-dashed p-8 text-center">
          <p className="font-medium">{t('doneTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('doneBody')}</p>
          {deck.perDay < 30 && <Button asChild variant="outline"><Link href={membershipPath}>{t('moreCards')}</Link></Button>}
        </div>
      )}
      {match && <MatchModal m={match} basePath={basePath} membershipPath={membershipPath} onClose={() => setMatch(null)} onSeeMatches={() => { setMatch(null); onMatches(); }} />}
    </div>
  );
}

function ProfileCard({ c }: { c: CofounderCard }) {
  const t = useTranslations('cofounder');
  const locale = useLocale() as Locale;
  const initials = c.displayName.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-end gap-3 bg-gradient-to-br from-primary-50 to-sky-50 p-4 dark:from-primary/20 dark:to-sky-900/20">
        {c.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar, sized here
          <img src={c.avatarUrl} alt="" className="size-16 rounded-2xl object-cover shadow" />
        ) : (
          <span className="flex size-16 items-center justify-center rounded-2xl bg-background text-xl font-bold text-primary-700 shadow">{initials}</span>
        )}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-lg font-bold"><bdi>{c.displayName}</bdi><MemberBadge badge={c.badge} /></p>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>{t(`roleLabel.${c.role}`)}</span>
            {c.city && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{getCityName(c.city, locale)}</span>}
            {c.remoteOk && <span className="inline-flex items-center gap-1"><Wifi className="size-3" />{t('remote')}</span>}
          </p>
        </div>
      </div>
      <div className="space-y-3 p-4 text-sm">
        {c.venture && <p className="text-xs font-medium text-primary-700">{c.venture.name} · {c.venture.sector}</p>}
        <p className="whitespace-pre-line leading-relaxed" dir="auto">{c.pitch}</p>
        <Chips label={t('brings')} items={c.brings.map((r) => t(`roles.${r}`))} strong />
        <Chips label={t('seeks')} items={c.lookingFor.map((r) => t(`roles.${r}`))} />
        <p className="text-xs text-muted-foreground">
          {c.commitment && t(`commitments.${c.commitment}`)}{c.sectors.length > 0 && ` · ${c.sectors.map((s) => t(`sectors.${s}`)).join(', ')}`}
        </p>
        {c.reasons.length > 0 && (
          <div className="rounded-lg border border-dashed border-primary-200 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary-700"><Sparkles className="size-3" />{t('why')}</p>
            <ul className="mt-1 space-y-0.5 text-xs">{c.reasons.map((r) => <li key={r} dir="auto">{r}</li>)}</ul>
          </div>
        )}
      </div>
    </article>
  );
}

function Chips({ label, items, strong }: { label: string; items: string[]; strong?: boolean }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => <span key={i} className={cn('rounded-full px-2.5 py-0.5 text-xs', strong ? 'bg-primary-50 font-medium text-primary-700' : 'border')}>{i}</span>)}
      </div>
    </div>
  );
}

function MatchModal({ m, basePath, membershipPath, onClose, onSeeMatches }: { m: MatchView; basePath: string; membershipPath: string; onClose: () => void; onSeeMatches: () => void }) {
  const t = useTranslations('cofounder');
  return (
    <div role="dialog" aria-modal="true" aria-label={t('matchTitle')} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-background p-6 text-center" onClick={(e) => e.stopPropagation()}>
        <Heart className="mx-auto size-10 fill-rose-500 text-rose-500" />
        <p className="text-xl font-bold">{t('matchTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('matchBody', { name: m.other.fullName })}</p>
        <MatchActions m={m} basePath={basePath} membershipPath={membershipPath} />
        <Button type="button" variant="ghost" className="w-full" onClick={onSeeMatches}>{t('seeMatches')}</Button>
      </div>
    </div>
  );
}

function MatchActions({ m, basePath, membershipPath }: { m: MatchView; basePath: string; membershipPath: string }) {
  const t = useTranslations('cofounder');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const messages = basePath.replace(/cofounder$/, 'messages');
  async function chat() {
    if (m.conversationId) { router.push(`${messages}?c=${m.conversationId}`); return; }
    setBusy(true);
    const res = await fetch(`/api/cofounder/matches/${m.id}/chat`, { method: 'POST' });
    setBusy(false);
    if (res.ok) router.push(`${messages}?c=${((await res.json()) as { conversationId: string }).conversationId}`);
  }
  if (!m.chatAllowed && !m.conversationId) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('upgradeToChat')}</p>
        <Button asChild className="w-full"><Link href={membershipPath}>{t('upgrade')}</Link></Button>
      </div>
    );
  }
  return <Button type="button" className="w-full" loading={busy} onClick={() => void chat()}><MessageSquare className="size-4" />{t('startChat')}</Button>;
}

/* ─────────────────────────── Matches ─────────────────────────── */

function Matches({ basePath, membershipPath }: { basePath: string; membershipPath: string }) {
  const t = useTranslations('cofounder');
  const locale = useLocale() as Locale;
  const [list, setList] = useState<MatchView[] | null>(null);
  useEffect(() => {
    void fetch('/api/cofounder/matches', { cache: 'no-store' }).then(async (r) => setList(r.ok ? ((await r.json()) as { matches: MatchView[] }).matches : []));
  }, []);
  if (!list) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (!list.length) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('noMatches')}</p>;
  return (
    <ul className="space-y-3">
      {list.map((m) => (
        <li key={m.id} className="space-y-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-50 font-semibold text-primary-700">
              {m.other.fullName.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-semibold"><bdi>{m.other.fullName}</bdi><MemberBadge badge={m.other.badge} /></p>
              <p className="text-xs text-muted-foreground">
                {t(`roleLabel.${m.other.role}`)}{m.other.city && ` · ${getCityName(m.other.city, locale)}`} · {m.other.brings.map((r) => t(`roles.${r}`)).join(', ')}
              </p>
              <p className="mt-1 line-clamp-3 text-sm" dir="auto">{m.other.pitch}</p>
            </div>
          </div>
          <MatchActions m={m} basePath={basePath} membershipPath={membershipPath} />
          <Button asChild variant="outline" className="w-full"><Link href={`${basePath}/match/${m.id}`}>{t('sprintAndAgreement')}</Link></Button>
        </li>
      ))}
    </ul>
  );
}

/* ─────────────────────────── Profile ─────────────────────────── */

function ProfileForm({ initial, onSaved }: { initial: CofounderProfileRecord; onSaved: (p: CofounderProfileRecord) => void }) {
  const t = useTranslations('cofounder');
  const [p, setP] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggleIn = (key: 'brings' | 'lookingFor' | 'sectors', v: string) =>
    setP((x) => ({ ...x, [key]: x[key].includes(v) ? x[key].filter((y) => y !== v) : [...x[key], v] }));
  const ready = isComplete(p) && VALUE_KEYS.every((k) => p.values[k]);

  async function save() {
    setBusy(true);
    setErr(null);
    const { enabled, brings, lookingFor, commitment, sectors, pitch, remoteOk, values, visibleTo } = p;
    const res = await fetch('/api/cofounder/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, brings, lookingFor, commitment, sectors, pitch, remoteOk, values, visibleTo }),
    });
    setBusy(false);
    if (!res.ok) { setErr(t('saveError')); return; }
    onSaved((await res.json()) as CofounderProfileRecord);
  }

  return (
    <div className="space-y-6">
      <Field label={t('brings')} hint={t('bringsHint')}>
        <ChipPicker options={COFOUNDER_ROLES} selected={p.brings} label={(r) => t(`roles.${r}`)} onToggle={(v) => toggleIn('brings', v)} />
      </Field>
      <Field label={t('seeks')} hint={t('seeksHint')}>
        <ChipPicker options={COFOUNDER_ROLES} selected={p.lookingFor} label={(r) => t(`roles.${r}`)} onToggle={(v) => toggleIn('lookingFor', v)} />
      </Field>
      <Field label={t('commitment')}>
        <div className="flex flex-col gap-2 sm:flex-row">
          {COMMITMENTS.map((c) => (
            <label key={c} className={cn('flex min-h-[44px] flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm', p.commitment === c && 'border-primary bg-primary-50/60 dark:bg-primary/10')}>
              <input type="radio" name="commitment" className="size-4" checked={p.commitment === c} onChange={() => setP((x) => ({ ...x, commitment: c }))} />
              {t(`commitments.${c}`)}
            </label>
          ))}
        </div>
      </Field>
      <Field label={t('sectorsLabel')}>
        <ChipPicker options={SECTORS} selected={p.sectors} label={(s) => t(`sectors.${s}`)} onToggle={(v) => toggleIn('sectors', v)} />
      </Field>
      <Field label={t('pitch')} hint={t('pitchHint', { min: PITCH_MIN })}>
        <Textarea rows={5} maxLength={PITCH_MAX} value={p.pitch} className="text-base sm:text-sm" placeholder={t('pitchPlaceholder')} onChange={(e) => setP((x) => ({ ...x, pitch: e.target.value }))} />
        <p className="text-end text-xs tabular-nums text-muted-foreground">{p.pitch.trim().length}/{PITCH_MAX}</p>
      </Field>
      <Field label={t('quizTitle')} hint={t('quizHint')}>
        <div className="space-y-4">
          {VALUE_KEYS.map((k) => (
            <fieldset key={k} className="space-y-1.5">
              <legend className="sr-only">{t(`quiz.${k}.question`)}</legend>
              <div className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{t(`quiz.${k}.low`)}</span><span className="text-end">{t(`quiz.${k}.high`)}</span></div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((v) => (
                  <label key={v} className={cn('flex min-h-[40px] cursor-pointer items-center justify-center rounded-md border text-sm', p.values[k] === v && 'border-primary bg-primary text-primary-foreground')}>
                    <input type="radio" name={`q-${k}`} className="sr-only" checked={p.values[k] === v} onChange={() => setP((x) => ({ ...x, values: { ...x.values, [k]: v } }))} />
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Field>
      <div className="space-y-3">
        <label className="flex min-h-[40px] items-center gap-3 text-sm"><input type="checkbox" className="size-5" checked={p.remoteOk} onChange={(e) => setP((x) => ({ ...x, remoteOk: e.target.checked }))} />{t('remoteOk')}</label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t('visibleTo')}</span>
          <select value={p.visibleTo} onChange={(e) => setP((x) => ({ ...x, visibleTo: e.target.value as CofounderProfileRecord['visibleTo'] }))} className="h-11 rounded-md border bg-background px-3 text-base sm:text-sm">
            <option value="EVERYONE">{t('visibleEveryone')}</option>
            <option value="ENTREPRENEURS">{t('visibleEntrepreneurs')}</option>
          </select>
        </label>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      <Button type="button" className="w-full sm:w-auto" loading={busy} disabled={!ready} onClick={() => void save()}>{t('save')}</Button>
      {!ready && <p className="text-xs text-muted-foreground">{t('saveHint')}</p>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{label}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ChipPicker<T extends string>({ options, selected, label, onToggle }: { options: readonly T[]; selected: string[]; label: (v: T) => string; onToggle: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={selected.includes(o)} onClick={() => onToggle(o)}
          className={cn('min-h-[36px] rounded-full border px-3 text-sm transition-colors', selected.includes(o) ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
          {label(o)}
        </button>
      ))}
    </div>
  );
}
