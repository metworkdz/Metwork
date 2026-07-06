'use client';

/**
 * Consultant phone verification via SMS OTP (/mentordashboard/verify-phone).
 *
 * Two steps, session-guarded server-side:
 *   1. show the phone on file → POST /consultant/phone/request (SMS via Infobip)
 *   2. code → POST /consultant/phone/verify → phoneVerified=true → back to dashboard
 *
 * Send failures never lose state — the code can be re-requested (30s cooldown).
 * Already-verified (or phoneless) accounts get a clear notice instead of a form.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, BadgeCheck, MessageSquareText, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantMe } from '@/services/consultant.service';
import { AppLogo, BrandButton, CP_GLOW, CP_GREEN, ErrorBanner, Spinner } from './shared';
import { OtpCodeInput } from './otp-code-input';

type Step = 'intro' | 'code' | 'done';

export function PhoneVerify() {
  const t = useTranslations('consultantPortal.phoneVerify');

  const [me, setMe] = useState<ConsultantMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('intro');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    let cancelled = false;
    consultantService
      .me()
      .then((res) => { if (!cancelled) setMe(res); })
      .catch(() => { if (!cancelled) window.location.assign('/mentordashboard'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const mapErr = useCallback((err: unknown): string => {
    if (err instanceof ApiClientError) {
      switch (err.code) {
        case 'INVALID_OTP': return t('errorInvalidOtp');
        case 'OTP_EXPIRED': return t('errorOtpExpired');
        case 'OTP_LOCKED': return t('errorOtpLocked');
        case 'RATE_LIMITED': return t('errorRateLimited');
        case 'NO_PHONE': return t('errorNoPhone');
        case 'ALREADY_VERIFIED': return t('alreadyVerified');
        default: return t('errorGeneric');
      }
    }
    return t('errorGeneric');
  }, [t]);

  async function requestCode(advance: boolean) {
    setBusy(true); setError(null);
    try {
      await consultantService.requestPhoneOtp();
      if (advance) setStep('code');
      setResendIn(30);
    } catch (err) {
      // A failed SMS send costs nothing — stay put with a clear message and
      // let the consultant retry; nothing about the account changes.
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await consultantService.verifyPhoneOtp(code.trim());
      setStep('done');
    } catch (err) {
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner className="py-24" />;

  const phone = me?.mentor.phone ?? null;
  const alreadyVerified = me?.mentor.phoneVerified === true;

  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <div
          className="flex items-center justify-center rounded-3xl border border-white/[0.08] px-8 py-7"
          style={{ backgroundImage: CP_GLOW }}
        >
          <AppLogo height={38} />
        </div>
        <p className="mt-4 text-sm text-white/50">{t('tagline')}</p>
      </div>

      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        {(alreadyVerified || step === 'done') ? (
          <div className="space-y-4 text-center">
            <BadgeCheck className="mx-auto size-9" style={{ color: CP_GREEN }} />
            <p className="font-medium text-white">{t('verifiedTitle')}</p>
            <p className="text-sm text-white/50">{t('verifiedDesc')}</p>
            <BrandButton type="button" className="w-full" onClick={() => window.location.assign('/mentordashboard')}>
              {t('backToDashboard')}
            </BrandButton>
          </div>
        ) : !phone ? (
          <div className="space-y-4 text-center">
            <p className="text-sm text-white/60">{t('errorNoPhone')}</p>
            <BrandButton type="button" className="w-full" onClick={() => window.location.assign('/mentordashboard')}>
              {t('backToDashboard')}
            </BrandButton>
          </div>
        ) : step === 'intro' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <MessageSquareText className="size-4" style={{ color: CP_GREEN }} /> {t('heading')}
            </div>
            <p className="text-sm text-white/50">{t('introDesc')}</p>
            <p dir="ltr" className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-center text-sm font-medium tracking-wide text-white">
              {phone}
            </p>
            {error && <ErrorBanner message={error} />}
            <BrandButton type="button" loading={busy} className="w-full" onClick={() => void requestCode(true)}>
              {t('sendCode')}
            </BrandButton>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/40">
              <ShieldCheck className="size-3.5" /> {t('secureNote')}
            </p>
            <a
              href="/mentordashboard"
              className="flex items-center justify-center gap-1 text-xs text-white/45 underline-offset-2 hover:text-white/70 hover:underline"
            >
              <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t('backToDashboard')}
            </a>
          </div>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2 text-center">
              <MessageSquareText className="mx-auto size-9" style={{ color: CP_GREEN }} />
              <p className="font-medium text-white">{t('codeSent')}</p>
              <p dir="ltr" className="text-sm text-white/50">{phone}</p>
            </div>
            <OtpCodeInput
              value={code} onChange={setCode} disabled={busy}
              label={t('codeLabel')} idPrefix="cp-phone-code"
            />
            {error && <ErrorBanner message={error} />}
            <BrandButton type="submit" loading={busy} disabled={code.trim().length < 6} className="w-full">
              {t('verify')}
            </BrandButton>
            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button" onClick={() => { setStep('intro'); setCode(''); setError(null); }}
                className="text-white/45 underline-offset-2 hover:text-white/70 hover:underline" disabled={busy}
              >
                {t('back')}
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
      </div>
    </div>
  );
}
