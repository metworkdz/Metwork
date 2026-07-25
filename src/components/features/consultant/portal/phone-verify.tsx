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
 * Light, centered-card surface — matches the login/signup page.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, BadgeCheck, MessageSquareText, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService, type ConsultantMe } from '@/services/consultant.service';
import {
  AppLogo, BrandButton, CP_GREEN, CP_GREEN_TEXT, CP_GREEN_TINT, CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED,
  ErrorBanner, Spinner,
} from './shared';
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
  /* Which channel carried the last code — WhatsApp by default; the consultant
     can explicitly fall back to SMS when the WhatsApp message doesn't arrive. */
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp');

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

  async function requestCode(advance: boolean, via: 'whatsapp' | 'sms' = 'whatsapp') {
    setBusy(true); setError(null);
    try {
      await consultantService.requestPhoneOtp(via);
      setChannel(via);
      if (advance) setStep('code');
      setResendIn(30);
      setCode('');
    } catch (err) {
      // A failed send costs nothing — stay put with a clear message and let
      // the consultant retry; nothing about the account changes.
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

  if (loading) {
    return (
      <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center">
        <Spinner tone="light" className="py-24" />
      </div>
    );
  }

  const phone = me?.mentor.phone ?? null;
  const alreadyVerified = me?.mentor.phoneVerified === true;

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="flex items-center justify-center rounded-3xl border px-8 py-7"
            style={{ borderColor: CP_LIGHT_BORDER, background: CP_GREEN_TINT }}
          >
            <AppLogo tone="light" height={38} />
          </div>
          <p className="mt-4 text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('tagline')}</p>
        </div>

        <div
          className="space-y-4 rounded-3xl border bg-white p-5 sm:p-7"
          style={{ borderColor: CP_LIGHT_BORDER, boxShadow: '0 20px 60px -20px rgba(13,13,13,0.12), 0 2px 8px rgba(13,13,13,0.04)' }}
        >
          {(alreadyVerified || step === 'done') ? (
            <div className="space-y-4 text-center">
              <BadgeCheck className="mx-auto size-9" style={{ color: CP_GREEN }} />
              <p className="font-medium text-[#0D0D0D]">{t('verifiedTitle')}</p>
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('verifiedDesc')}</p>
              <BrandButton tone="light" type="button" className="w-full" onClick={() => window.location.assign('/mentordashboard')}>
                {t('backToDashboard')}
              </BrandButton>
            </div>
          ) : !phone ? (
            <div className="space-y-4 text-center">
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('errorNoPhone')}</p>
              <BrandButton tone="light" type="button" className="w-full" onClick={() => window.location.assign('/mentordashboard')}>
                {t('backToDashboard')}
              </BrandButton>
            </div>
          ) : step === 'intro' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#0D0D0D]">
                <MessageSquareText className="size-4" style={{ color: CP_GREEN }} /> {t('heading')}
              </div>
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('introDesc')}</p>
              <p dir="ltr" className="rounded-xl border px-3.5 py-2.5 text-center text-sm font-medium tracking-wide text-[#0D0D0D]"
                style={{ borderColor: CP_LIGHT_BORDER, background: '#F7F8F9' }}>
                {phone}
              </p>
              {error && <ErrorBanner tone="light" message={error} />}
              <BrandButton tone="light" type="button" loading={busy} className="w-full" onClick={() => void requestCode(true, 'whatsapp')}>
                {t('sendCodeWhatsApp')}
              </BrandButton>
              <p className="flex items-center justify-center gap-1.5 text-[11px]" style={{ color: CP_LIGHT_FAINT }}>
                <ShieldCheck className="size-3.5" /> {t('secureNote')}
              </p>
              <a
                href="/mentordashboard"
                className="flex items-center justify-center gap-1 text-xs underline-offset-2 hover:underline"
                style={{ color: CP_LIGHT_MUTED }}
              >
                <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t('backToDashboard')}
              </a>
            </div>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div className="space-y-2 text-center">
                <MessageSquareText className="mx-auto size-9" style={{ color: CP_GREEN }} />
                <p className="font-medium text-[#0D0D0D]">
                  {channel === 'whatsapp' ? t('codeSentWhatsApp') : t('codeSentSms')}
                </p>
                <p dir="ltr" className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{phone}</p>
              </div>
              <OtpCodeInput
                value={code} onChange={setCode} disabled={busy}
                label={t('codeLabel')} idPrefix="cp-phone-code" tone="light"
              />
              {error && <ErrorBanner tone="light" message={error} />}
              <BrandButton tone="light" type="submit" loading={busy} disabled={code.trim().length < 6} className="w-full">
                {t('verify')}
              </BrandButton>
              <div className="flex items-center justify-between text-[11px]">
                <button
                  type="button" onClick={() => { setStep('intro'); setCode(''); setError(null); }}
                  className="underline-offset-2 hover:underline" style={{ color: CP_LIGHT_MUTED }} disabled={busy}
                >
                  {t('back')}
                </button>
                <button
                  type="button" onClick={() => void requestCode(false, channel)}
                  disabled={busy || resendIn > 0}
                  className="underline-offset-2 hover:underline disabled:no-underline"
                  style={{ color: busy || resendIn > 0 ? CP_LIGHT_FAINT : CP_LIGHT_MUTED }}
                >
                  {resendIn > 0 ? t('resendCountdown', { seconds: resendIn }) : t('resend')}
                </button>
              </div>
              {/* WhatsApp didn't arrive → explicit SMS fallback (new code, same verify). */}
              {channel === 'whatsapp' && (
                <button
                  type="button"
                  onClick={() => void requestCode(false, 'sms')}
                  disabled={busy || resendIn > 0}
                  className="w-full text-center text-xs font-medium underline-offset-2 hover:underline disabled:no-underline"
                  style={{ color: busy || resendIn > 0 ? CP_LIGHT_FAINT : CP_GREEN_TEXT }}
                >
                  {t('fallbackSms')}
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
