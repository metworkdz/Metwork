'use client';

import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { CheckCircle2, Download, FileSignature, Lock, ShieldCheck } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { SignaturePad, type SignaturePadHandle } from '@/components/shared/signature-pad';
import { cn } from '@/lib/utils';
import type { FreelancerContractView } from '@/server/freelancer-contracts/service';

type Step = 'read' | 'sign' | 'code';

const ERRORS: Record<string, string> = {
  INVALID: 'invalidCode',
  EXPIRED: 'expiredCode',
  LOCKED: 'locked',
  TOO_MANY_ATTEMPTS: 'locked',
  OTP_LOCKED: 'locked',
  OTP_THROTTLED: 'throttled',
  RATE_LIMITED: 'throttled',
  DELIVERY_FAILED: 'deliveryFailed',
  BAD_SIGNATURE: 'badSignature',
  BAD_ID_NUMBER: 'badIdNumber',
  NO_PHONE: 'noPhone',
  NOT_PENDING: 'notPending',
  STORAGE_FAILED: 'storageFailed',
};

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: string } };
    return res.ok ? { ok: true, data: json } : { ok: false, code: json.error?.code ?? 'GENERIC' };
  } catch {
    return { ok: false, code: 'GENERIC' };
  }
}

/**
 * The freelancer's Metwork contract: read, then CIN + drawn signature, then a
 * code sent to their phone. Signed: the date, the fingerprint and the PDF.
 */
export function ContractSigning({
  initial,
  profilePercent,
}: {
  initial: FreelancerContractView | null;
  profilePercent: number;
}) {
  const t = useTranslations('freelancerContract');
  const format = useFormatter();
  const [contract, setContract] = useState(initial);
  const [step, setStep] = useState<Step>('read');
  const [idNumber, setIdNumber] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const padRef = useRef<SignaturePadHandle | null>(null);
  const signatureRef = useRef<string | null>(null);
  const cinOk = /^\d{9,18}$/.test(idNumber.replace(/\s+/g, ''));

  const fail = (c: string) => setError(t(`errors.${ERRORS[c] ?? 'generic'}`));

  if (!contract) {
    return (
      <section className="space-y-3 rounded-[1.25rem] border border-border bg-background p-5">
        <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Lock className="size-5" /></span>
        <h2 className="font-display text-lg font-extrabold">{t('lockedTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('lockedBody', { percent: profilePercent })}</p>
        <Link href="/dashboard/freelancer/profile" className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">
          {t('completeProfile')}
        </Link>
      </section>
    );
  }

  if (contract.status === 'SIGNED') {
    return (
      <section className="space-y-4 rounded-[1.25rem] border border-primary bg-primary-50/40 p-5 dark:bg-primary/10">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><CheckCircle2 className="size-6" /></span>
        <div>
          <h2 className="font-display text-lg font-extrabold">{t('signedTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('signedBody', { date: contract.signedAt ? format.dateTime(new Date(contract.signedAt), { dateStyle: 'long' }) : '' })}</p>
        </div>
        <p className="break-all rounded-xl bg-background p-3 font-mono text-[0.6875rem] text-muted-foreground" dir="ltr">SHA-256 · {contract.finalPdfHash}</p>
        <a
          href={`/api/freelancer/contract/pdf?id=${contract.id}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
        >
          <Download className="size-4" />{t('download')}
        </a>
      </section>
    );
  }

  async function toCode() {
    setError(null);
    const png = padRef.current?.toDataUrl() ?? null;
    if (!png) { fail('BAD_SIGNATURE'); return; }
    if (!cinOk) { fail('BAD_ID_NUMBER'); return; }
    signatureRef.current = png;
    setStep('code');
    await sendCode('whatsapp');
  }

  async function sendCode(channel: 'whatsapp' | 'sms') {
    if (!contract) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await post('/api/freelancer/contract/code', { contractId: contract.id, channel });
    setBusy(false);
    if (r.ok) setNotice(channel === 'sms' ? t('codeSentSms') : t('codeSentWhatsapp'));
    else fail(r.code);
  }

  async function sign() {
    if (!contract || !signatureRef.current) return;
    setBusy(true);
    setError(null);
    const r = await post<{ contract: FreelancerContractView }>('/api/freelancer/contract/sign', {
      contractId: contract.id,
      signaturePng: signatureRef.current,
      code: code.trim(),
      idNumber: idNumber.replace(/\s+/g, ''),
    });
    setBusy(false);
    if (r.ok) setContract(r.data.contract);
    else fail(r.code);
  }

  const steps: Step[] = ['read', 'sign', 'code'];

  return (
    <div className="space-y-4">
      <ol className="flex gap-2" aria-label={t('stepsLabel')}>
        {steps.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', steps.indexOf(step) >= i ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>{i + 1}</span>
            <span className={cn('truncate text-xs font-medium', steps.indexOf(step) >= i ? 'text-foreground' : 'text-muted-foreground')}>{t(`step.${s}`)}</span>
          </li>
        ))}
      </ol>

      {step === 'read' && (
        <section className="space-y-4">
          <div className="rounded-[1.25rem] border border-primary-200 bg-primary-50/40 p-4 text-sm dark:bg-primary/10">
            <p className="font-semibold">{t('ratesTitle')}</p>
            <ul className="mt-2 space-y-1 text-foreground/85">
              <li>{t('rateMissions', { free: contract.rates.sourcedFree, premium: contract.rates.sourcedPremium })}</li>
              <li>{t('rateLinks', { free: contract.rates.linkFree, premium: contract.rates.linkPremium })}</li>
            </ul>
          </div>
          <div
            dir="ltr"
            lang="fr"
            tabIndex={0}
            aria-label={t('textLabel')}
            className="max-h-[55dvh] overflow-y-auto whitespace-pre-wrap rounded-[1.25rem] border border-border bg-background p-4 text-[0.8125rem] leading-relaxed"
          >
            {contract.contentSnapshot.replace('{{freelancer_id_number}}', '…')}
          </div>
          <button type="button" onClick={() => setStep('sign')} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[0.9375rem] font-semibold text-primary-foreground">
            <FileSignature className="size-5" />{t('readDone')}
          </button>
        </section>
      )}

      {step === 'sign' && (
        <section className="space-y-4 rounded-[1.25rem] border border-border bg-background p-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">{t('cinLabel')}</span>
            <input
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              value={idNumber}
              maxLength={24}
              onChange={(e) => setIdNumber(e.target.value.replace(/[^\d\s]/g, ''))}
              className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base tracking-wider outline-none focus:border-primary"
              placeholder="1099 9000 1234 5678 9"
            />
            <span className="block text-xs text-muted-foreground">{t('cinHint')}</span>
          </label>
          <div className="space-y-1.5">
            <span className="text-sm font-semibold">{t('signatureLabel')}</span>
            <SignaturePad ref={padRef} onChange={setHasSignature} disabled={busy} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setStep('read'); setError(null); }} className="min-h-12 rounded-2xl border border-border text-sm font-semibold">{t('back')}</button>
            <button type="button" disabled={!hasSignature || !cinOk || busy} onClick={() => void toCode()} className="min-h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50">{t('continue')}</button>
          </div>
        </section>
      )}

      {step === 'code' && (
        <section className="space-y-4 rounded-[1.25rem] border border-border bg-background p-4">
          <p className="flex items-start gap-2 text-sm"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />{t('codeIntro')}</p>
          {notice && <p className="text-sm text-primary-700">{notice}</p>}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            maxLength={8}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            aria-label={t('codeLabel')}
            className="h-14 w-full rounded-xl border border-border bg-background px-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-primary"
          />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button type="button" disabled={code.length < 4 || busy} onClick={() => void sign()} className="min-h-12 w-full rounded-2xl bg-primary text-[0.9375rem] font-semibold text-primary-foreground disabled:opacity-50">
            {busy ? t('signing') : t('sign')}
          </button>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            <button type="button" disabled={busy} onClick={() => void sendCode('whatsapp')} className="min-h-11 font-medium text-primary hover:underline">{t('resendWhatsapp')}</button>
            <button type="button" disabled={busy} onClick={() => void sendCode('sms')} className="min-h-11 font-medium text-muted-foreground hover:underline">{t('resendSms')}</button>
          </div>
        </section>
      )}
    </div>
  );
}
