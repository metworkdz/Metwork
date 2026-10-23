'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Circle, FileUp, Gift, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Link, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { computeCompletion, BIO_MIN_CHARS, MIN_SKILLS, MIN_PORTFOLIO_ITEMS, type CompletionKey } from '@/lib/freelancer-completion';
import { acceptedDocumentsFor, type LegalStatus } from '@/types/legal-status';
import { PayoutAccountStep } from '@/components/features/wallet/withdrawal-form';
import { SHEET_CONTENT_CLASS, type PayoutAccount } from '@/components/features/wallet/payout-account';
import type { LegalVerificationStatus } from '@/types/auth';

/** Statuses a freelancer can prove with a document the review understands. */
const DOCUMENT_STATUSES = ['AUTO_ENTREPRENEUR', 'INDIVIDUAL_IFU', 'COMPANY'] as const satisfies readonly LegalStatus[];
const LANGUAGES = ['ar', 'fr', 'en', 'tzm'] as const;

export interface EditorProfile {
  headline: string | null;
  bio: string | null;
  skills: string[];
  languages: string[];
  remote: boolean;
  dayRate: number | null;
  address: string | null;
  portfolio: { id: string; title: string; imageUrl: string | null; url: string | null }[];
  legal: {
    status: LegalStatus;
    documentKind: string;
    submittedAt: string;
    review: { state: LegalVerificationStatus; reasons: string[]; at: string; by: string };
  } | null;
  trial?: { unlockedAt: string; startedAt?: string };
}

interface Props {
  user: {
    fullName: string;
    phone: string | null;
    city: string | null;
    avatarUrl: string | null;
    payoutAccount: PayoutAccount | null;
  };
  initial: EditorProfile;
  premiumOnSale: boolean;
}

async function readError(res: Response): Promise<{ code?: string; message?: string }> {
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  return body.error ?? {};
}

export function FreelancerProfileEditor({ user, initial, premiumOnSale }: Props) {
  const t = useTranslations('freelancer.profile');
  const router = useRouter();
  const [profile, setProfile] = useState<EditorProfile>(initial);
  const [payout, setPayout] = useState<PayoutAccount | null>(user.payoutAccount);
  const [legalState, setLegalState] = useState<LegalVerificationStatus | null>(initial.legal?.review.state ?? null);
  const completion = computeCompletion(
    { ...user, payoutAccount: payout, legalVerificationStatus: legalState },
    profile,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <CompletionCard percent={completion.percent} items={completion.items} />
        <TrialCard
          percent={completion.percent}
          trial={profile.trial}
          premiumOnSale={premiumOnSale}
          onStarted={() => router.refresh()}
        />
      </div>
      <div className="min-w-0 space-y-6">
        <DetailsCard profile={profile} onSaved={setProfile} />
        <DocumentCard
          legal={profile.legal}
          onReviewed={(state) => {
            setLegalState(state);
            router.refresh();
          }}
        />
        <PayoutCard account={payout} onSaved={setPayout} />
        <p className="text-xs text-muted-foreground">
          {t('photoHint')}{' '}
          <Link href="/dashboard/freelancer/settings" className="font-medium text-primary hover:underline">
            {t('photoLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Completion ring ─────────────────────────── */

function CompletionCard({ percent, items }: { percent: number; items: { key: CompletionKey; weight: number; done: boolean }[] }) {
  const t = useTranslations('freelancer.profile');
  const r = 46;
  const circumference = 2 * Math.PI * r;
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="relative mx-auto size-32">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
            <circle cx="60" cy="60" r={r} fill="none" strokeWidth="12" className="stroke-muted" />
            <circle
              cx="60" cy="60" r={r} fill="none" strokeWidth="12" strokeLinecap="round"
              className="stroke-primary transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - percent / 100)}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center" role="status" aria-label={t('ringLabel', { percent })}>
            <span className="text-3xl font-bold tabular-nums">{percent}%</span>
            <span className="text-xs text-muted-foreground">{t('ringCaption')}</span>
          </div>
        </div>
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 text-sm">
              {i.done ? (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <Circle className="size-5 shrink-0 text-muted-foreground" />
              )}
              <span className={cn('min-w-0 flex-1', i.done && 'text-muted-foreground')}>{t(`items.${i.key}`)}</span>
              <span className="text-xs tabular-nums text-muted-foreground">+{i.weight}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Trial ─────────────────────────── */

function TrialCard({
  percent, trial, premiumOnSale, onStarted,
}: { percent: number; trial?: { unlockedAt: string; startedAt?: string }; premiumOnSale: boolean; onStarted: () => void }) {
  const t = useTranslations('freelancer.profile.trial');
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const unlocked = percent === 100 || !!trial?.unlockedAt;

  function start() {
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/freelancer/trial', { method: 'POST' });
      if (!res.ok) {
        setError((await readError(res)).message ?? t('error'));
        return;
      }
      onStarted();
    });
  }

  return (
    <Card className={cn(unlocked && !trial?.startedAt && 'border-gold-600/60 bg-gold-50/60 dark:bg-gold-900/10')}>
      <CardContent className="space-y-2 p-5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Gift className="size-4" />
          {trial?.startedAt ? t('startedTitle') : unlocked ? t('unlockedTitle') : t('lockedTitle')}
        </p>
        <p className="text-xs text-muted-foreground">
          {trial?.startedAt
            ? t('startedBody')
            : unlocked
              ? premiumOnSale ? t('unlockedBody') : t('unlockedNotOpen')
              : t('lockedBody', { points: 100 - percent })}
        </p>
        {unlocked && !trial?.startedAt && premiumOnSale && (
          <Button size="sm" className="w-full bg-gold-600 text-[#0D0D0D] hover:bg-gold-700" loading={busy} onClick={start}>
            {t('start')}
          </Button>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Details + portfolio ─────────────────────────── */

function DetailsCard({ profile, onSaved }: { profile: EditorProfile; onSaved: (p: EditorProfile) => void }) {
  const t = useTranslations('freelancer.profile');
  const [headline, setHeadline] = useState(profile.headline ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [skills, setSkills] = useState<string[]>(profile.skills);
  const [skillDraft, setSkillDraft] = useState('');
  const [languages, setLanguages] = useState<string[]>(profile.languages);
  const [remote, setRemote] = useState(profile.remote);
  const [dayRate, setDayRate] = useState(profile.dayRate ? String(profile.dayRate) : '');
  const [address, setAddress] = useState(profile.address ?? '');
  const [portfolio, setPortfolio] = useState(profile.portfolio);
  const [saving, startSaving] = useTransition();
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addSkill() {
    const s = skillDraft.trim();
    if (s && !skills.includes(s) && skills.length < 20) setSkills([...skills, s]);
    setSkillDraft('');
  }

  async function addPortfolioImage(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'portfolio');
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error();
      const { url } = (await res.json()) as { url: string };
      setPortfolio((p) => [...p, { id: '', title: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || t('portfolioUntitled'), imageUrl: url, url: null }]);
    } catch {
      setStatus('error');
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setStatus('idle');
    startSaving(async () => {
      const res = await fetch('/api/freelancer/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: headline || null,
          bio: bio || null,
          skills,
          languages,
          remote,
          dayRate: dayRate ? Number(dayRate) : null,
          address: address || null,
          portfolio: portfolio.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            title: p.title,
            imageUrl: p.imageUrl,
            url: p.url || null,
          })),
        }),
      });
      if (!res.ok) { setStatus('error'); return; }
      const body = (await res.json()) as { profile: EditorProfile };
      setPortfolio(body.profile.portfolio);
      onSaved(body.profile);
      setStatus('saved');
    });
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('detailsTitle')}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <Field id="fp-headline" label={t('headline')} hint={t('headlineHint')}>
          <Input id="fp-headline" value={headline} maxLength={80} onChange={(e) => setHeadline(e.target.value)} placeholder={t('headlinePlaceholder')} className="text-base sm:text-sm" />
        </Field>
        <Field id="fp-bio" label={t('bio')} hint={t('bioHint', { min: BIO_MIN_CHARS, count: bio.trim().length })}>
          <Textarea id="fp-bio" value={bio} maxLength={2000} rows={5} onChange={(e) => setBio(e.target.value)} placeholder={t('bioPlaceholder')} className="text-base sm:text-sm" />
        </Field>
        <Field id="fp-skill" label={t('skills')} hint={t('skillsHint', { min: MIN_SKILLS })}>
          <div className="flex gap-2">
            <Input
              id="fp-skill" value={skillDraft} maxLength={40}
              onChange={(e) => setSkillDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
              placeholder={t('skillsPlaceholder')} className="text-base sm:text-sm"
            />
            <Button type="button" variant="outline" onClick={addSkill} aria-label={t('addSkill')}><Plus className="size-4" /></Button>
          </div>
          {skills.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {skills.map((s) => (
                <li key={s} className="flex items-center gap-1 rounded-full border bg-muted/40 py-1 pe-1 ps-3 text-sm">
                  {s}
                  <button type="button" className="flex size-7 items-center justify-center rounded-full hover:bg-muted" aria-label={t('removeSkill', { skill: s })} onClick={() => setSkills(skills.filter((x) => x !== s))}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="fp-rate" label={t('dayRate')} hint={t('dayRateHint')}>
            <Input id="fp-rate" inputMode="numeric" dir="ltr" value={dayRate} onChange={(e) => setDayRate(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="15000" className="text-base tabular-nums sm:text-sm" />
          </Field>
          <Field id="fp-address" label={t('address')} hint={t('addressHint')}>
            <Input id="fp-address" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)} className="text-base sm:text-sm" />
          </Field>
        </div>
        <fieldset>
          <legend className="text-sm font-medium">{t('languages')}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LANGUAGES.map((l) => {
              const on = languages.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on}
                  onClick={() => setLanguages(on ? languages.filter((x) => x !== l) : [...languages, l])}
                  className={cn('min-h-[40px] rounded-full border px-4 text-sm transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}>
                  {t(`lang.${l}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 rounded border-input" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          {t('remote')}
        </label>

        {/* Portfolio */}
        <div className="space-y-3 border-t pt-5">
          <div>
            <p className="text-sm font-medium">{t('portfolio')}</p>
            <p className="text-xs text-muted-foreground">{t('portfolioHint', { min: MIN_PORTFOLIO_ITEMS })}</p>
          </div>
          {portfolio.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {portfolio.map((item, idx) => (
                <li key={item.id || `new-${idx}`} className="space-y-2 rounded-lg border p-3">
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt={item.title} className="aspect-[4/3] w-full rounded-md object-cover" />
                  )}
                  <Input aria-label={t('portfolioTitle')} value={item.title} maxLength={80}
                    onChange={(e) => setPortfolio(portfolio.map((p, i) => (i === idx ? { ...p, title: e.target.value } : p)))} className="text-base sm:text-sm" />
                  <Input aria-label={t('portfolioLink')} dir="ltr" value={item.url ?? ''} placeholder="https://"
                    onChange={(e) => setPortfolio(portfolio.map((p, i) => (i === idx ? { ...p, url: e.target.value } : p)))} className="text-base sm:text-sm" />
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => setPortfolio(portfolio.filter((_, i) => i !== idx))}>
                    <Trash2 className="size-4" /> {t('portfolioRemove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPortfolioImage(f); e.target.value = ''; }} />
          <Button type="button" variant="outline" loading={uploading} disabled={portfolio.length >= 12} onClick={() => fileRef.current?.click()}>
            <ImagePlus className="size-4" /> {t('portfolioAdd')}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-5">
          <Button type="button" loading={saving} onClick={save}>{t('save')}</Button>
          {status === 'saved' && <span className="text-sm text-emerald-600">{t('saved')}</span>}
          {status === 'error' && <span role="alert" className="text-sm text-destructive">{t('saveError')}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/* ─────────────────────────── Business document ─────────────────────────── */

function DocumentCard({ legal, onReviewed }: { legal: EditorProfile['legal']; onReviewed: (s: LegalVerificationStatus) => void }) {
  const t = useTranslations('freelancer.profile.document');
  const [status, setStatus] = useState<(typeof DOCUMENT_STATUSES)[number]>(
    (legal && (DOCUMENT_STATUSES as readonly string[]).includes(legal.status) ? legal.status : 'AUTO_ENTREPRENEUR') as (typeof DOCUMENT_STATUSES)[number],
  );
  const [review, setReview] = useState(legal?.review ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = acceptedDocumentsFor(status)[0]!;

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('status', status);
      form.append('kind', kind);
      form.append('file', file);
      const res = await fetch('/api/freelancer/legal-document', { method: 'POST', body: form });
      if (!res.ok) {
        const err = await readError(res);
        setError(err.code === 'FILE_TOO_LARGE' ? t('tooLarge') : err.code === 'UNSUPPORTED_FILE' ? t('unsupported') : err.code === 'RATE_LIMITED' ? t('rateLimited') : t('uploadError'));
        return;
      }
      const body = (await res.json()) as { review: { state: LegalVerificationStatus; reasons: string[] } };
      setReview({ ...body.review, at: new Date().toISOString(), by: 'AUTO' });
      onReviewed(body.review.state);
    } catch {
      setError(t('uploadError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        {review && (
          <div className={cn('rounded-md border p-3 text-sm',
            review.state === 'APPROVED' ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
            : review.state === 'REJECTED' ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200')}>
            <p className="font-medium">{t(`state.${review.state}`)}</p>
            {review.state === 'PENDING' && <p className="mt-1 text-xs">{t('pendingBody')}</p>}
            {review.state === 'REJECTED' && review.reasons[0] && <p className="mt-1 text-xs">{review.reasons[0]}</p>}
          </div>
        )}
        <fieldset>
          <legend className="text-sm font-medium">{t('statusLabel')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {DOCUMENT_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
                className={cn('min-h-[44px] rounded-lg border-2 px-3 py-2 text-start text-sm transition-colors', status === s ? 'border-primary bg-primary-50/60 dark:bg-primary/10' : 'border-border hover:bg-muted/50')}>
                {t(`status.${s}`)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('needs', { document: t(`kind.${kind}`) })}</p>
        </fieldset>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
        <Button type="button" variant={review?.state === 'APPROVED' ? 'outline' : 'default'} loading={busy} onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" /> {busy ? t('checking') : review ? t('replace') : t('upload')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('privacy')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── Payout account ─────────────────────────── */

function PayoutCard({ account, onSaved }: { account: PayoutAccount | null; onSaved: (a: PayoutAccount) => void }) {
  const t = useTranslations('freelancer.profile.payout');
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{account ? t('saved', { holder: account.holderName, last4: account.accountNumber.slice(-4) }) : t('empty')}</p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>{account ? t('edit') : t('add')}</Button>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={SHEET_CONTENT_CLASS}>
          <PayoutAccountStep initial={account} onSaved={(a) => { onSaved(a); setOpen(false); }} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
