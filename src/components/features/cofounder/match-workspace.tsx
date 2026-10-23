'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Download, FileSignature, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SignaturePad, type SignaturePadHandle } from '@/components/shared/signature-pad';
import { algerianCities, getCityName } from '@/config/cities';
import { COMMITMENTS } from '@/lib/cofounder';
import { SPRINT_DAYS, SPRINT_ITEMS, sprintDay } from '@/lib/cofounder-sprint';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { CofounderAgreementIdentity, CofounderAgreementTerms, CofounderSprintRecord } from '@/server/db/store';
import type { AgreementView } from '@/server/cofounder/agreement';

interface Props {
  matchId: string;
  me: string;
  other: { id: string; name: string };
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? 'GENERIC';
}

/** After a match: the 14-day trial sprint, then the cofounder agreement. */
export function MatchWorkspace({ matchId, me, other }: Props) {
  return (
    <div className="space-y-8">
      <Sprint matchId={matchId} me={me} otherName={other.name} />
      <Agreement matchId={matchId} me={me} other={other} />
    </div>
  );
}

/* ─────────────────────────── Sprint ─────────────────────────── */

function Sprint({ matchId, me, otherName }: { matchId: string; me: string; otherName: string }) {
  const t = useTranslations('cofounderSprint');
  const [sprint, setSprint] = useState<CofounderSprintRecord | null | undefined>(undefined);
  useEffect(() => {
    void fetch(`/api/cofounder/matches/${matchId}/sprint`, { cache: 'no-store' }).then(async (r) => setSprint(r.ok ? ((await r.json()) as { sprint: CofounderSprintRecord | null }).sprint : null));
  }, [matchId]);

  async function set(item: (typeof SPRINT_ITEMS)[number] | null, done: boolean) {
    const res = await fetch(`/api/cofounder/matches/${matchId}/sprint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item, done }) });
    if (res.ok) setSprint(((await res.json()) as { sprint: CofounderSprintRecord }).sprint);
  }

  if (sprint === undefined) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  const day = sprint ? sprintDay(sprint.startedAt) : 0;
  const doneCount = sprint ? Object.keys(sprint.done).length : 0;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t('title')}</h2>
        {sprint && <span className="text-xs text-muted-foreground">{day > SPRINT_DAYS ? t('over') : t('day', { day, total: SPRINT_DAYS })} · {doneCount}/{SPRINT_ITEMS.length}</span>}
      </div>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {!sprint ? (
        <Button type="button" onClick={() => void set(null, false)}>{t('start')}</Button>
      ) : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${(doneCount / SPRINT_ITEMS.length) * 100}%` }} /></div>
          <ul className="divide-y rounded-lg border">
            {SPRINT_ITEMS.map((k) => {
              const d = sprint.done[k];
              return (
                <li key={k}>
                  <label className="flex min-h-[52px] cursor-pointer items-start gap-3 p-3">
                    <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={Boolean(d)} onChange={(e) => void set(k, e.target.checked)} />
                    <span className="min-w-0">
                      <span className={cn('block text-sm font-medium', d && 'text-muted-foreground line-through')}>{t(`items.${k}.title`)}</span>
                      <span className="block text-xs text-muted-foreground">{t(`items.${k}.hint`)}</span>
                      {d && <span className="block text-xs text-emerald-700">{t('doneBy', { name: d.by === me ? t('you') : otherName })}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/* ─────────────────────────── Agreement ─────────────────────────── */

const KNOWN = ['EXISTS', 'NOT_DRAFT', 'NOT_PENDING', 'INCOMPLETE', 'INVALID_TERMS', 'ALREADY_SIGNED', 'SIGNED_BY_OTHER', 'BAD_SIGNATURE', 'LOCKED', 'INVALID', 'EXPIRED', 'TOO_MANY_ATTEMPTS', 'NO_PHONE', 'STORAGE_FAILED', 'OTP_THROTTLED', 'OTP_LOCKED', 'DELIVERY_FAILED', 'VALIDATION_ERROR'];

function Agreement({ matchId, me, other }: { matchId: string; me: string; other: { id: string; name: string } }) {
  const t = useTranslations('cofounderAgreement');
  const [a, setA] = useState<AgreementView | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/cofounder/matches/${matchId}/agreement`, { cache: 'no-store' }).then(async (r) => setA(r.ok ? ((await r.json()) as { agreement: AgreementView | null }).agreement : null));
  }, [matchId]);

  async function call(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setErr(null);
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    setBusy(null);
    if (!res.ok) {
      const code = await errorCode(res);
      setErr(t(`errors.${KNOWN.includes(code) ? code : 'GENERIC'}`));
      return null;
    }
    const body = (await res.json()) as { agreement?: AgreementView };
    if (body.agreement) setA(body.agreement);
    return body;
  }

  if (a === undefined) return null;
  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 font-semibold"><FileSignature className="size-5" />{t('title')}</h2>
      <div role="note" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <Scale className="mt-0.5 size-4 shrink-0" /><p>{t('disclaimer')}</p>
      </div>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      {(!a || a.status === 'CANCELLED') && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('intro')}</p>
          <Button type="button" loading={busy === 'create'} onClick={() => void call('create', `/api/cofounder/matches/${matchId}/agreement`, { method: 'POST' })}>{t('start')}</Button>
        </div>
      )}

      {a?.status === 'DRAFT' && (
        <Draft a={a} me={me} other={other} busy={busy}
          onTerms={(terms) => void call('terms', `/api/cofounder/agreements/${a.id}`, { method: 'PATCH', body: JSON.stringify({ terms }) })}
          onIdentity={(identity) => void call('identity', `/api/cofounder/agreements/${a.id}`, { method: 'PATCH', body: JSON.stringify({ identity }) })}
          onSend={() => void call('send', `/api/cofounder/agreements/${a.id}`, { method: 'POST', body: JSON.stringify({ action: 'SEND' }) })}
          onCancel={() => { if (window.confirm(t('confirmCancel'))) void call('cancel', `/api/cofounder/agreements/${a.id}`, { method: 'POST', body: JSON.stringify({ action: 'CANCEL' }) }); }}
        />
      )}

      {a?.status === 'PENDING_SIGNATURES' && (
        <Pending a={a} me={me} other={other} busy={busy} call={call} />
      )}

      {a?.status === 'SIGNED' && (
        <div className="space-y-3 rounded-xl border-2 border-emerald-300 p-4">
          <p className="flex items-center gap-2 font-semibold text-emerald-700"><Check className="size-5" />{t('signedTitle')}</p>
          <p className="text-sm text-muted-foreground">{t('signedBody')}</p>
          <Button asChild><a href={`/api/cofounder/agreements/${a.id}/pdf`} target="_blank" rel="noopener noreferrer"><Download className="size-4" />{t('download')}</a></Button>
          {a.finalPdfHash && <p className="break-all font-mono text-[11px] text-muted-foreground" dir="ltr">SHA-256 {a.finalPdfHash}</p>}
        </div>
      )}
    </section>
  );
}

function Draft({ a, me, other, busy, onTerms, onIdentity, onSend, onCancel }: {
  a: AgreementView; me: string; other: { id: string; name: string }; busy: string | null;
  onTerms: (t: CofounderAgreementTerms) => void; onIdentity: (i: CofounderAgreementIdentity) => void; onSend: () => void; onCancel: () => void;
}) {
  const t = useTranslations('cofounderAgreement');
  const tc = useTranslations('cofounder');
  const locale = useLocale() as Locale;
  const [terms, setTerms] = useState(a.terms);
  const [identity, setIdentity] = useState<CofounderAgreementIdentity>(a.identities[me] ?? { legalName: '', idNumber: '', birthDate: '', address: '' });
  useEffect(() => { setTerms(a.terms); }, [a.version, a.terms]);
  const people = [{ id: me, name: t('you') }, { id: other.id, name: other.name }];
  const sum = people.reduce((s, p) => s + (terms.equity[p.id] ?? 0), 0) + terms.reservePercent;
  const setPerson = (key: 'roles' | 'commitments' | 'equity', id: string, v: string | number) => setTerms((x) => ({ ...x, [key]: { ...x[key], [id]: v } }));
  const bothIdentities = Boolean(a.identities[me] && a.identities[other.id]);

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t('termsTitle')}</h3>
        <label className="block text-sm"><span className="font-medium">{t('projectName')}</span>
          <Input className="mt-1 text-base sm:text-sm" value={terms.projectName} maxLength={120} onChange={(e) => setTerms((x) => ({ ...x, projectName: e.target.value }))} /></label>
        <label className="block text-sm"><span className="font-medium">{t('projectDescription')}</span>
          <Textarea className="mt-1 text-base sm:text-sm" rows={3} maxLength={1000} value={terms.projectDescription} onChange={(e) => setTerms((x) => ({ ...x, projectDescription: e.target.value }))} /></label>
        {people.map((p) => (
          <fieldset key={p.id} className="space-y-2 rounded-md bg-muted/40 p-3">
            <legend className="text-sm font-semibold">{p.name}</legend>
            <div className="grid gap-2 sm:grid-cols-[1fr_180px_110px]">
              <Input aria-label={t('role')} placeholder={t('rolePlaceholder')} className="text-base sm:text-sm" value={terms.roles[p.id] ?? ''} maxLength={80} onChange={(e) => setPerson('roles', p.id, e.target.value)} />
              <select aria-label={tc('commitment')} className="h-10 rounded-md border bg-background px-2 text-base sm:text-sm" value={terms.commitments[p.id] ?? 'FULL_TIME'} onChange={(e) => setPerson('commitments', p.id, e.target.value)}>
                {COMMITMENTS.map((c) => <option key={c} value={c}>{tc(`commitments.${c}`)}</option>)}
              </select>
              <label className="flex items-center gap-1 text-sm"><Input aria-label={t('equity')} inputMode="decimal" dir="ltr" className="text-base tabular-nums sm:text-sm" value={String(terms.equity[p.id] ?? '')} onChange={(e) => setPerson('equity', p.id, Number(e.target.value.replace(',', '.')) || 0)} />%</label>
            </div>
          </fieldset>
        ))}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NumberField label={t('reserve')} value={terms.reservePercent} suffix="%" onChange={(v) => setTerms((x) => ({ ...x, reservePercent: v }))} />
          <NumberField label={t('vesting')} value={terms.vestingMonths} suffix={t('months')} onChange={(v) => setTerms((x) => ({ ...x, vestingMonths: Math.round(v) }))} />
          <NumberField label={t('cliff')} value={terms.cliffMonths} suffix={t('months')} onChange={(v) => setTerms((x) => ({ ...x, cliffMonths: Math.round(v) }))} />
          <label className="block text-sm"><span className="font-medium">{t('jurisdiction')}</span>
            <select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-base sm:text-sm" value={terms.jurisdiction} onChange={(e) => setTerms((x) => ({ ...x, jurisdiction: e.target.value }))}>
              {algerianCities.map((c) => <option key={c.code} value={c.code}>{getCityName(c.code, locale)}</option>)}
            </select></label>
        </div>
        <p className={cn('text-xs', sum === 100 ? 'text-muted-foreground' : 'font-medium text-destructive')}>{t('sum', { sum })}</p>
        <p className="text-xs text-muted-foreground">{t('vestingHint')}</p>
        <Button type="button" variant="outline" loading={busy === 'terms'} onClick={() => onTerms(terms)}>{t('saveTerms')}</Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t('identityTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('identityHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={t('legalName')} value={identity.legalName} onChange={(v) => setIdentity((x) => ({ ...x, legalName: v }))} />
          <TextField label={t('idNumber')} value={identity.idNumber} onChange={(v) => setIdentity((x) => ({ ...x, idNumber: v }))} ltr />
          <TextField label={t('birthDate')} value={identity.birthDate} onChange={(v) => setIdentity((x) => ({ ...x, birthDate: v }))} type="date" />
          <TextField label={t('address')} value={identity.address} onChange={(v) => setIdentity((x) => ({ ...x, address: v }))} />
        </div>
        <Button type="button" variant="outline" loading={busy === 'identity'} onClick={() => onIdentity(identity)}>{t('saveIdentity')}</Button>
        <p className="text-xs text-muted-foreground">{a.identities[other.id] ? t('otherIdentityDone', { name: other.name }) : t('otherIdentityMissing', { name: other.name })}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="button" loading={busy === 'send'} disabled={!bothIdentities} onClick={onSend}>{t('send')}</Button>
        <Button type="button" variant="ghost" className="text-destructive" onClick={onCancel}>{t('cancel')}</Button>
      </div>
      {!bothIdentities && <p className="text-xs text-muted-foreground">{t('sendHint')}</p>}
    </div>
  );
}

function NumberField({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (v: number) => void }) {
  return (
    <label className="block text-sm"><span className="font-medium">{label}</span>
      <span className="mt-1 flex items-center gap-1"><Input inputMode="decimal" dir="ltr" className="text-base tabular-nums sm:text-sm" value={String(value)} onChange={(e) => onChange(Number(e.target.value.replace(',', '.')) || 0)} /><span className="text-xs text-muted-foreground">{suffix}</span></span>
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text', ltr }: { label: string; value: string; onChange: (v: string) => void; type?: string; ltr?: boolean }) {
  return (
    <label className="block text-sm"><span className="font-medium">{label}</span>
      <Input type={type} dir={ltr || type === 'date' ? 'ltr' : 'auto'} className="mt-1 text-base sm:text-sm" value={value} onChange={(e) => onChange(e.target.value)} /></label>
  );
}

function Pending({ a, me, other, busy, call }: {
  a: AgreementView; me: string; other: { id: string; name: string }; busy: string | null;
  call: (key: string, url: string, init: RequestInit) => Promise<unknown>;
}) {
  const t = useTranslations('cofounderAgreement');
  const pad = useRef<SignaturePadHandle>(null);
  const [hasSig, setHasSig] = useState(false);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const iSigned = Boolean(a.signed[me]);
  const anySigned = Object.values(a.signed).some(Boolean);

  async function sendCode(channel: 'whatsapp' | 'sms') {
    const r = await call(`code-${channel}`, `/api/cofounder/agreements/${a.id}/code`, { method: 'POST', body: JSON.stringify({ channel }) });
    if (r) setSent(true);
  }
  async function doSign() {
    const signature = pad.current?.toDataUrl();
    if (!signature) return;
    await call('sign', `/api/cofounder/agreements/${a.id}/sign`, { method: 'POST', body: JSON.stringify({ signature, code }) });
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-1 text-sm">
        {[{ id: me, name: t('you') }, other].map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            {a.signed[p.id] ? <Check className="size-4 text-emerald-600" /> : <span className="size-4 rounded-full border-2" />}
            {p.name} — {a.signed[p.id] ? t('hasSigned') : t('toSign')}
          </li>
        ))}
      </ul>
      <details className="rounded-lg border">
        <summary className="cursor-pointer p-3 text-sm font-medium">{t('readText')}</summary>
        <pre dir="ltr" className="max-h-96 overflow-y-auto whitespace-pre-wrap border-t p-3 font-sans text-xs leading-relaxed">{a.contentSnapshot?.replace('{{signature_block}}', '')}</pre>
      </details>
      {!iSigned && (
        <div className="space-y-3 rounded-xl border-2 border-primary-200 p-4">
          <h3 className="font-semibold">{t('signTitle')}</h3>
          <SignaturePad ref={pad} onChange={setHasSig} note={t('signNote')} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" loading={busy === 'code-whatsapp'} onClick={() => void sendCode('whatsapp')}>{t('codeWhatsapp')}</Button>
            <Button type="button" variant="ghost" loading={busy === 'code-sms'} onClick={() => void sendCode('sms')}>{t('codeSms')}</Button>
          </div>
          {sent && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input aria-label={t('code')} placeholder={t('code')} inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="text-base tracking-widest sm:w-40 sm:text-sm" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              <Button type="button" loading={busy === 'sign'} disabled={!hasSig || code.length < 4} onClick={() => void doSign()}>{t('sign')}</Button>
            </div>
          )}
        </div>
      )}
      {iSigned && <p className="text-sm text-muted-foreground">{t('waitOther', { name: other.name })}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {!anySigned && <Button type="button" variant="outline" onClick={() => void call('reopen', `/api/cofounder/agreements/${a.id}`, { method: 'POST', body: JSON.stringify({ action: 'REOPEN' }) })}>{t('reopen')}</Button>}
        <Button type="button" variant="ghost" className="text-destructive" onClick={() => { if (window.confirm(t('confirmCancel'))) void call('cancel', `/api/cofounder/agreements/${a.id}`, { method: 'POST', body: JSON.stringify({ action: 'CANCEL' }) }); }}>{t('cancel')}</Button>
      </div>
    </div>
  );
}
