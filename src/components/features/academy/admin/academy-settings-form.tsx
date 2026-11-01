'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/routing';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { passPrices } from '@/lib/academy';
import type { AcademySettingsRecord } from '@/server/db/store';

type AddendumState = 'NONE' | 'DRAFT' | 'PENDING_SIGNATURE' | 'SIGNED';
interface MentorShareRow { id: string; fullName: string; rate: number | null; courseCount: number; addendum: AddendumState }

const pct = (r: number) => Math.round(r * 1000) / 10;

/**
 * Academy settings: Pass price and discounts, default mentor share, certificate
 * stamp, the mentor addendum's text, and per mentor their share and addendum.
 */
export function AcademySettingsForm({ initial, mentors, defaultAddendum }: { initial: AcademySettingsRecord; mentors: MentorShareRow[]; defaultAddendum: string }) {
  const t = useTranslations('academyAdmin.settings');
  const [s, setS] = useState({
    price: String(initial.passMonthlyPriceDzd),
    annual: String(pct(initial.passAnnualDiscountRate)),
    premium: String(pct(initial.premiumDiscountRate)),
    share: String(pct(initial.defaultMentorShareRate)),
    stamp: initial.certificateStampUrl ?? '',
    addendum: initial.addendumTemplate ?? defaultAddendum,
  });
  const [addenda, setAddenda] = useState(() => Object.fromEntries(mentors.map((m) => [m.id, m.addendum])));
  // Shown under the mentor's row: on a phone the page-level message is screens away.
  const [rowMsg, setRowMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [shares, setShares] = useState(() => Object.fromEntries(mentors.map((m) => [m.id, m.rate === null ? '' : String(pct(m.rate))])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const preview = passPrices({
    passMonthlyPriceDzd: Number(s.price) || 0,
    passAnnualDiscountRate: (Number(s.annual) || 0) / 100,
    premiumDiscountRate: (Number(s.premium) || 0) / 100,
    defaultMentorShareRate: (Number(s.share) || 0) / 100,
  });

  const KNOWN = ['INVALID_PRICE', 'INVALID_RATE', 'INVALID_STAMP_URL', 'MENTOR_NOT_FOUND', 'ALREADY_EXISTS', 'CONSULTANT_NOT_FOUND', 'INCOMPLETE_CONSULTANT_PROFILE', 'NO_TEMPLATE'];
  const errorText = (err: unknown) => (err instanceof ApiClientError && KNOWN.includes(err.code) ? t(`errors.${err.code}`) : t('errors.generic'));
  const fail = (err: unknown) => setMsg({ ok: false, text: errorText(err) });

  async function save() {
    setBusy('settings');
    setMsg(null);
    try {
      await apiClient.patch('/admin/academy/settings', {
        passMonthlyPriceDzd: Math.round(Number(s.price)),
        passAnnualDiscountRate: Number(s.annual) / 100,
        premiumDiscountRate: Number(s.premium) / 100,
        defaultMentorShareRate: Number(s.share) / 100,
        certificateStampUrl: s.stamp.trim() || null,
        // The built-in text is stored as null, so it keeps following the code.
        addendumTemplate: s.addendum.trim() === defaultAddendum.trim() ? null : s.addendum,
      });
      setMsg({ ok: true, text: t('saved') });
    } catch (err) { fail(err); } finally { setBusy(null); }
  }

  async function saveShare(id: string) {
    setBusy(id);
    setMsg(null);
    const raw = shares[id]?.trim() ?? '';
    try {
      await apiClient.put(`/admin/academy/mentors/${id}/share`, { rate: raw === '' ? null : Number(raw) / 100 });
      setMsg({ ok: true, text: t('shareSaved') });
    } catch (err) { fail(err); } finally { setBusy(null); }
  }

  /** Draft the mentor's addendum; the admin then sends it from the Contracts page. */
  async function prepareAddendum(id: string) {
    setBusy(`addendum-${id}`);
    setRowMsg(null);
    try {
      await apiClient.post(`/admin/academy/mentors/${id}/addendum`);
      setAddenda({ ...addenda, [id]: 'DRAFT' });
      setRowMsg({ id, ok: true, text: t('addendum.prepared') });
    } catch (err) {
      setRowMsg({ id, ok: false, text: errorText(err) });
    } finally { setBusy(null); }
  }

  const num = (key: keyof typeof s, label: string, suffix: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`s-${key}`}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={`s-${key}`} type="number" inputMode="decimal" value={s[key]} onChange={(e) => setS({ ...s, [key]: e.target.value })} />
        <span className="text-sm text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('pass')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {num('price', t('monthlyPrice'), 'DA')}
          {num('annual', t('annualDiscount'), '%')}
          {num('premium', t('premiumDiscount'), '%')}
        </div>
        <p className="text-sm text-muted-foreground">{t('preview', preview)}</p>
        <p className="text-xs text-muted-foreground">{t('appliesToNew')}</p>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('mentorsTitle')}</h2>
        <div className="max-w-xs">{num('share', t('defaultShare'), '%')}</div>
        <p className="text-xs text-muted-foreground">{t('shareHint')}</p>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('certificate')}</h2>
        <div className="space-y-1.5">
          <Label htmlFor="s-stamp">{t('stampUrl')}</Label>
          <Input id="s-stamp" dir="ltr" placeholder="https://res.cloudinary.com/…" value={s.stamp} onChange={(e) => setS({ ...s, stamp: e.target.value })} />
          <p className="text-xs text-muted-foreground">{t('stampHint')}</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s.stamp.startsWith('https://') && <img src={s.stamp} alt="" className="h-24 w-auto rounded border border-border bg-white p-2" />}
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('addendum.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('addendum.hint')}</p>
        <Textarea aria-label={t('addendum.title')} dir="ltr" rows={12} maxLength={30_000} className="font-mono text-xs"
          value={s.addendum} onChange={(e) => setS({ ...s, addendum: e.target.value })} />
        <Button type="button" variant="ghost" size="sm" onClick={() => setS({ ...s, addendum: defaultAddendum })}>{t('addendum.reset')}</Button>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy !== null}>{busy === 'settings' && <Loader2 className="me-1 size-4 animate-spin" />}{t('save')}</Button>
        {msg && <p role="status" className={msg.ok ? 'text-sm text-primary' : 'text-sm text-destructive'}>{msg.text}</p>}
      </div>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-base font-extrabold">{t('perMentor')}</h2>
        <p className="text-xs text-muted-foreground">{t('perMentorHint', { rate: s.share })}</p>
        <ul className="divide-y divide-border">
          {mentors.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{m.fullName}</p>
                <p className="text-xs text-muted-foreground">{t('courses', { count: m.courseCount })}</p>
              </div>
              <div className="flex items-center gap-2">
                <Input aria-label={t('shareOf', { name: m.fullName })} className="w-24" type="number" inputMode="decimal" placeholder={s.share}
                  value={shares[m.id] ?? ''} onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })} />
                <span className="text-sm text-muted-foreground">%</span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => saveShare(m.id)}>{t('saveShare')}</Button>
              </div>
              <div className="flex w-full items-center gap-2 text-xs sm:w-auto">
                <span className={addenda[m.id] === 'SIGNED' ? 'font-semibold text-primary' : 'text-muted-foreground'}>{t(`addendum.state.${addenda[m.id]}`)}</span>
                {addenda[m.id] === 'NONE' && (
                  <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => prepareAddendum(m.id)}>
                    {busy === `addendum-${m.id}` && <Loader2 className="me-1 size-4 animate-spin" />}{t('addendum.prepare')}
                  </Button>
                )}
                {addenda[m.id] === 'DRAFT' && <Link href="/dashboard/admin/contracts" className="font-semibold text-primary hover:underline">{t('addendum.send')}</Link>}
              </div>
              {rowMsg?.id === m.id && <p role="status" className={rowMsg.ok ? 'w-full text-xs text-primary' : 'w-full text-xs text-destructive'}>{rowMsg.text}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
