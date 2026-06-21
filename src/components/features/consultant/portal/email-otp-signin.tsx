'use client';

/**
 * Consultant email → OTP sign-in (untrusted device / first sign-in).
 *
 * Three steps, no client storage:
 *   1. email  → POST /consultant/otp/request (always generic; enumeration-safe)
 *   2. code   → POST /consultant/otp/verify  → mints the session, tells us if a
 *               PIN already exists
 *   3. setPin → first-time PIN creation + optional "remember this device"
 *
 * On completion it navigates to /mentordashboard (a full load so the server
 * entry re-evaluates the freshly-set session cookie). A failed send surfaces a
 * clear error and never advances the step.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService } from '@/services/consultant.service';
import { AppLogo, BrandButton, CP_GLOW, CP_GREEN, ErrorBanner, cpInputClass } from './shared';

type Step = 'email' | 'code' | 'setPin';

function BrandHeader({ tagline }: { tagline: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <div
        className="flex items-center justify-center rounded-3xl border border-white/[0.08] px-8 py-7"
        style={{ backgroundImage: CP_GLOW }}
      >
        <AppLogo height={38} />
      </div>
      <p className="mt-4 text-sm text-white/50">{tagline}</p>
    </div>
  );
}

export function EmailOtpSignIn() {
  const t = useTranslations('consultantPortal.signin');
  const ta = useTranslations('consultantPortal.access');

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const done = useCallback(() => { window.location.assign('/mentordashboard'); }, []);

  const mapErr = useCallback((err: unknown): string => {
    if (err instanceof ApiClientError) {
      switch (err.code) {
        case 'INVALID_OTP': return t('errorInvalidOtp');
        case 'OTP_EXPIRED': return t('errorOtpExpired');
        case 'OTP_LOCKED': return t('errorOtpLocked');
        case 'RATE_LIMITED': return t('errorRateLimited');
        case 'INVALID_PIN_FORMAT': return ta('invalidFormat');
        default: return t('errorGeneric');
      }
    }
    return t('errorGeneric');
  }, [t, ta]);

  async function requestCode(advance: boolean) {
    setBusy(true); setError(null);
    try {
      await consultantService.requestOtp(email.trim());
      if (advance) setStep('code');
      setResendIn(30);
    } catch (err) {
      // A real failure (rate limit / server) stays put with a clear message —
      // the step never advances on a send that didn't go through.
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await consultantService.verifyOtp(email.trim(), code.trim());
      if (res.pinSet) done();
      else setStep('setPin');
    } catch (err) {
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function savePin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await consultantService.setPin({ pin: pin.trim(), rememberDevice: remember });
      done();
    } catch (err) {
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <BrandHeader tagline={t('tagline')} />
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        {step === 'email' && (
          <form onSubmit={(e) => { e.preventDefault(); void requestCode(true); }} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Mail className="size-4" style={{ color: CP_GREEN }} /> {t('heading')}
            </div>
            <p className="text-sm text-white/50">{t('emailSubtitle')}</p>
            {error && <ErrorBanner message={error} />}
            <div className="space-y-1.5">
              <label htmlFor="cp-email" className="text-xs font-medium text-white/70">{t('emailLabel')}</label>
              <input
                id="cp-email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')} dir="ltr" disabled={busy}
                className={cpInputClass}
              />
            </div>
            <BrandButton type="submit" loading={busy} disabled={!email.trim()} className="w-full">
              {t('sendCode')}
            </BrandButton>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/40">
              <ShieldCheck className="size-3.5" /> {t('secureNote')}
            </p>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2 text-center">
              <CheckCircle2 className="mx-auto size-9" style={{ color: CP_GREEN }} />
              <p className="font-medium text-white">{t('codeSent')}</p>
              <p className="text-sm text-white/50">{t('codeSentDesc')}</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cp-code" className="text-xs font-medium text-white/70">{t('codeLabel')}</label>
              <input
                id="cp-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr"
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('codePlaceholder')} disabled={busy}
                className={`${cpInputClass} text-center text-lg tracking-[0.4em]`}
              />
            </div>
            {error && <ErrorBanner message={error} />}
            <BrandButton type="submit" loading={busy} disabled={code.trim().length < 6} className="w-full">
              {t('verify')}
            </BrandButton>
            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button" onClick={() => { setStep('email'); setCode(''); setError(null); }}
                className="text-white/45 underline-offset-2 hover:text-white/70 hover:underline" disabled={busy}
              >
                {t('changeEmail')}
              </button>
              <button
                type="button" onClick={() => void requestCode(false)}
                disabled={busy || resendIn > 0}
                className="text-white/45 underline-offset-2 hover:text-white/70 hover:underline disabled:no-underline disabled:hover:text-white/45"
              >
                {resendIn > 0 ? t('resendCountdown', { seconds: resendIn }) : t('resend')}
              </button>
            </div>
          </form>
        )}

        {step === 'setPin' && (
          <form onSubmit={savePin} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <KeyRound className="size-4" style={{ color: CP_GREEN }} /> {ta('setHeading')}
            </div>
            <p className="text-sm text-white/50">{ta('setSubtitle')}</p>
            <div className="space-y-1.5">
              <label htmlFor="cp-pin" className="text-xs font-medium text-white/70">{ta('pinLabel')}</label>
              <input
                id="cp-pin" inputMode="numeric" autoComplete="off" dir="ltr"
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={ta('pinPlaceholder')} disabled={busy}
                className={`${cpInputClass} text-center text-lg tracking-[0.4em]`}
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
              <input
                type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                disabled={busy} className="size-4 accent-[#2ECC71]"
              />
              {ta('rememberDevice')}
            </label>
            {error && <ErrorBanner message={error} />}
            <BrandButton type="submit" loading={busy} disabled={pin.trim().length < 4} className="w-full">
              {ta('submitSet')}
            </BrandButton>
          </form>
        )}
      </div>
    </div>
  );
}
