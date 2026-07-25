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
 *
 * Light, centered-card surface (brand system) — desktop widens the card and
 * adds breathing room; mobile keeps a single comfortable column.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { CheckCircle2, FileText, KeyRound, Mail, ShieldCheck, UploadCloud, UserPlus, X } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService } from '@/services/consultant.service';
import { algerianCities, getCityName } from '@/config/cities';
import { consultationFields, getConsultationFieldLabel } from '@/config/consultation-fields';
import {
  AppLogo, BrandButton, CP_GREEN, CP_GREEN_TEXT, CP_GREEN_TINT, CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED,
  ErrorBanner, GhostButton, calLocale, cpInputClassLight, uploadConsultantFile,
} from './shared';
import { OtpCodeInput } from './otp-code-input';

type Step = 'email' | 'signup' | 'code' | 'cv' | 'setPin';

const MAX_CV_BYTES = 5 * 1024 * 1024;

/**
 * "1 Infos → 2 Code → 3 PIN" indicator, shown only during self-registration
 * so a first-time visitor always knows where they are. Login stays clean.
 */
function StepIndicator({ current, labels }: { current: 1 | 2 | 3; labels: [string, string, string] }) {
  return (
    <ol className="flex items-center justify-center gap-1.5" aria-label={labels[current - 1]}>
      {labels.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const active = n === current;
        const done = n < current;
        return (
          <li key={label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-4" style={{ background: CP_LIGHT_BORDER }} />}
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                active ? 'text-white' : done ? 'text-[#2A2F2C]' : ''
              }`}
              style={active ? { backgroundColor: CP_GREEN } : { color: CP_LIGHT_FAINT }}
            >
              <span className="tabular-nums">{n}</span>
              <span className={active ? '' : 'hidden sm:inline'}>{label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function BrandHeader({ tagline }: { tagline: string }) {
  return (
    <div className="mb-8 flex flex-col items-center text-center">
      <div
        className="flex items-center justify-center rounded-3xl border px-8 py-7"
        style={{ borderColor: CP_LIGHT_BORDER, background: CP_GREEN_TINT }}
      >
        <AppLogo tone="light" height={38} />
      </div>
      <p className="mt-4 text-sm" style={{ color: CP_LIGHT_MUTED }}>{tagline}</p>
    </div>
  );
}

export function EmailOtpSignIn() {
  const t = useTranslations('consultantPortal.signin');
  const ta = useTranslations('consultantPortal.access');
  const ts = useTranslations('consultantPortal.signup');

  // /consultant/login?signup=1 (landing-page CTA) opens directly on the form.
  const startOnSignup = useSearchParams().get('signup') === '1';
  const [step, setStep] = useState<Step>(startOnSignup ? 'signup' : 'email');
  /* True while the visitor is in the self-registration flow (drives the step
     indicator on the shared code/PIN screens). */
  const [signupFlow, setSignupFlow] = useState(startOnSignup);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  /* Self-signup form state */
  const routeLocale = useLocale();
  const locale = calLocale(routeLocale);
  const [fullName, setFullName] = useState('');
  const [position, setPosition] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [field, setField] = useState('');
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  /* CV is held client-side until the OTP verify mints a session — the upload
     endpoint is session-guarded, so the file goes up right after verification. */
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvFieldError, setCvFieldError] = useState<string | null>(null);
  const [cvUploadError, setCvUploadError] = useState<string | null>(null);
  const [pinAlreadySet, setPinAlreadySet] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const done = useCallback(() => { window.location.assign('/mentordashboard'); }, []);

  const mapErr = useCallback((err: unknown): string => {
    if (err instanceof ApiClientError) {
      switch (err.code) {
        case 'NO_ACCOUNT': return t('errorNoAccount');
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

  async function submitSignup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // Generic 200 whether the email is new (PENDING account created) or
      // already a consultant (a sign-in OTP is sent instead) — both continue
      // to the same code step.
      await consultantService.signup({
        fullName: fullName.trim(),
        position: position.trim(),
        email: email.trim(),
        phone: phone.trim(),
        city: city.trim() || null,
        field: field || null,
        acceptPrivacy,
      });
      setStep('code');
      setResendIn(30);
    } catch (err) {
      setError(mapErr(err));
    } finally {
      setBusy(false);
    }
  }

  function onCvChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCvFieldError(null);
    const file = e.target.files?.[0] ?? null;
    if (!file) { setCvFile(null); return; }
    if (file.type !== 'application/pdf') { setCvFile(null); setCvFieldError(ts('cvTypeError')); return; }
    if (file.size > MAX_CV_BYTES) { setCvFile(null); setCvFieldError(ts('cvSizeError')); return; }
    setCvFile(file);
  }

  /** After the CV step (or when there is none): first sign-in sets a PIN. */
  const afterVerify = useCallback((pinSet: boolean) => {
    if (pinSet) done();
    else setStep('setPin');
  }, [done]);

  /**
   * Upload the CV using the freshly-minted session. Non-blocking by design: a
   * failure keeps the file in memory and offers retry/skip — the account and
   * session are already safe, and the portal has a CV re-upload in the profile.
   */
  async function uploadCv(pinSet: boolean) {
    if (!cvFile) { afterVerify(pinSet); return; }
    setBusy(true); setCvUploadError(null);
    try {
      await uploadConsultantFile(cvFile, 'cv');
      setCvFile(null);
      afterVerify(pinSet);
    } catch (err) {
      setCvUploadError(err instanceof Error ? err.message : ts('cvUploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await consultantService.verifyOtp(email.trim(), code.trim());
      setPinAlreadySet(res.pinSet);
      if (cvFile) {
        // Signup path with a pending CV — session now exists, upload it.
        setStep('cv');
        setBusy(false);
        void uploadCv(res.pinSet);
        return;
      }
      afterVerify(res.pinSet);
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

  const labelCls = 'text-sm font-medium';

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-8 sm:px-6 lg:py-14">
      <div className="w-full max-w-sm lg:max-w-md">
        <BrandHeader tagline={t('tagline')} />
        <div
          className="space-y-4 rounded-3xl border bg-white p-5 sm:p-7 lg:p-8"
          style={{ borderColor: CP_LIGHT_BORDER, boxShadow: '0 20px 60px -20px rgba(13,13,13,0.12), 0 2px 8px rgba(13,13,13,0.04)' }}
        >
          {step === 'email' && (
            <form onSubmit={(e) => { e.preventDefault(); void requestCode(true); }} className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[#0D0D0D]">
                <Mail className="size-4" style={{ color: CP_GREEN }} /> {t('heading')}
              </div>
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('emailSubtitle')}</p>
              {error && <ErrorBanner tone="light" message={error} />}
              <div className="space-y-1.5">
                <label htmlFor="cp-email" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{t('emailLabel')}</label>
                <input
                  id="cp-email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')} dir="ltr" disabled={busy}
                  className={cpInputClassLight}
                />
              </div>
              <BrandButton tone="light" type="submit" loading={busy} disabled={!email.trim()} className="w-full">
                {t('sendCode')}
              </BrandButton>
              <p className="flex items-center justify-center gap-1.5 text-xs" style={{ color: CP_LIGHT_MUTED }}>
                <ShieldCheck className="size-3.5" /> {t('secureNote')}
              </p>
              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1" style={{ background: CP_LIGHT_BORDER }} />
                <span className="text-xs" style={{ color: CP_LIGHT_FAINT }}>{ts('noAccountYet')}</span>
                <span className="h-px flex-1" style={{ background: CP_LIGHT_BORDER }} />
              </div>
              <GhostButton
                tone="light"
                type="button"
                onClick={() => { setStep('signup'); setSignupFlow(true); setError(null); }}
                disabled={busy}
                className="w-full"
              >
                <UserPlus className="size-4" style={{ color: CP_GREEN }} />
                {ts('createAccountCta')}
              </GhostButton>
            </form>
          )}

          {step === 'signup' && (
            <form onSubmit={submitSignup} className="space-y-4">
              <StepIndicator current={1} labels={[ts('step1'), ts('step2'), ts('step3')]} />
              <div className="flex items-center gap-2 text-base font-medium text-[#0D0D0D]">
                <UserPlus className="size-4" style={{ color: CP_GREEN }} /> {ts('heading')}
              </div>
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{ts('subtitle')}</p>
              {error && <ErrorBanner tone="light" message={error} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="cp-su-name" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ts('fullNameLabel')}</label>
                  <input
                    id="cp-su-name" type="text" required minLength={2} maxLength={120}
                    value={fullName} onChange={(e) => setFullName(e.target.value)}
                    disabled={busy} className={cpInputClassLight}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="cp-su-position" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ts('positionLabel')}</label>
                  <input
                    id="cp-su-position" type="text" required minLength={2} maxLength={160}
                    value={position} onChange={(e) => setPosition(e.target.value)}
                    placeholder={ts('positionPlaceholder')}
                    disabled={busy} className={cpInputClassLight}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cp-su-email" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{t('emailLabel')}</label>
                <input
                  id="cp-su-email" type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('emailPlaceholder')} dir="ltr" disabled={busy}
                  className={cpInputClassLight}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="cp-su-phone" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ts('phoneLabel')}</label>
                  <input
                    id="cp-su-phone" type="tel" required value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+213 555 00 00 00" dir="ltr" disabled={busy}
                    className={cpInputClassLight}
                  />
                  <p className="text-[11px]" style={{ color: CP_LIGHT_FAINT }}>{ts('phoneCountryCodeHint')}</p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="cp-su-city" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ts('cityLabel')}</label>
                  <select
                    id="cp-su-city" required value={city}
                    onChange={(e) => setCity(e.target.value)}
                    disabled={busy} className={cpInputClassLight}
                  >
                    <option value="" disabled>{ts('cityPlaceholder')}</option>
                    {algerianCities.map((c) => (
                      // Stored value is the French display name — consistent with
                      // every existing mentor record (rendered raw on profiles).
                      <option key={c.code} value={c.nameFr}>
                        {getCityName(c.code, locale)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cp-su-field" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ts('fieldLabel')}</label>
                <select
                  id="cp-su-field" required value={field}
                  onChange={(e) => setField(e.target.value)}
                  disabled={busy} className={cpInputClassLight}
                >
                  <option value="" disabled>{ts('fieldPlaceholder')}</option>
                  {consultationFields.map((f) => (
                    <option key={f.code} value={f.code}>
                      {getConsultationFieldLabel(f.code, locale)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <span className={`block ${labelCls}`} style={{ color: CP_LIGHT_MUTED }}>{ts('cvLabel')}</span>
                {cvFile ? (
                  <div className="flex items-center gap-3 rounded-2xl border px-3.5 py-3"
                    style={{ borderColor: 'rgba(48,167,53,0.35)', background: CP_GREEN_TINT }}>
                    <FileText className="size-5 shrink-0" style={{ color: CP_GREEN }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#0D0D0D]">{cvFile.name}</span>
                      <span className="block text-xs" style={{ color: CP_LIGHT_MUTED }}>
                        {(cvFile.size / (1024 * 1024)).toFixed(1)} MB — {ts('cvSelected')}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => { setCvFile(null); setCvFieldError(null); }}
                      disabled={busy}
                      aria-label={ts('cvRemove')}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors hover:bg-black/5"
                      style={{ color: CP_LIGHT_MUTED }}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="cp-su-cv"
                    className="flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors hover:bg-[#F7F8F9]"
                    style={{ borderColor: cvFieldError ? '#FCA5A5' : '#D1D6D3', background: cvFieldError ? '#FEF2F2' : '#F7F8F9' }}
                  >
                    <UploadCloud className="size-6" style={{ color: CP_GREEN }} />
                    <span className="text-sm font-medium text-[#0D0D0D]">{ts('cvDropTitle')}</span>
                    <span className="text-xs" style={{ color: CP_LIGHT_MUTED }}>{ts('cvHint')}</span>
                    <input
                      id="cp-su-cv" type="file" accept="application/pdf" className="sr-only"
                      onChange={onCvChange} disabled={busy}
                    />
                  </label>
                )}
                {cvFieldError && <p className="text-sm text-red-600">{cvFieldError}</p>}
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: CP_LIGHT_FAINT }}>{ts('reviewNote')}</p>

              {/* Explicit data-processing consent — Law 18-07 (required) */}
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>
                <input
                  type="checkbox"
                  checked={acceptPrivacy}
                  onChange={(e) => setAcceptPrivacy(e.target.checked)}
                  disabled={busy}
                  className="mt-0.5 size-4 shrink-0 rounded"
                  style={{ accentColor: CP_GREEN }}
                />
                <span>
                  {ts.rich('privacyAgreement', {
                    privacyLink: (chunks) => (
                      <a
                        href={`/${routeLocale}/privacy-policy`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium underline underline-offset-2"
                        style={{ color: CP_GREEN_TEXT }}
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </span>
              </label>

              <BrandButton
                tone="light"
                type="submit" loading={busy}
                disabled={
                  fullName.trim().length < 2 || position.trim().length < 2 || !email.trim() ||
                  phone.trim().length < 6 || !city || !field || !cvFile || !acceptPrivacy
                }
                className="w-full"
              >
                {ts('submit')}
              </BrandButton>
              <p className="text-center text-sm" style={{ color: CP_LIGHT_MUTED }}>
                {ts('alreadyHaveAccount')}{' '}
                <button
                  type="button"
                  onClick={() => { setStep('email'); setSignupFlow(false); setError(null); }}
                  disabled={busy}
                  className="font-medium underline-offset-2 hover:underline"
                  style={{ color: CP_GREEN_TEXT }}
                >
                  {ts('backToSignIn')}
                </button>
              </p>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={verify} className="space-y-4">
              {signupFlow && <StepIndicator current={2} labels={[ts('step1'), ts('step2'), ts('step3')]} />}
              <div className="space-y-2 text-center">
                <CheckCircle2 className="mx-auto size-9" style={{ color: CP_GREEN }} />
                <p className="text-base font-medium text-[#0D0D0D]">{t('codeSent')}</p>
                <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('codeSentDesc')}</p>
              </div>
              <OtpCodeInput
                value={code} onChange={setCode} disabled={busy}
                label={t('codeLabel')} idPrefix="cp-code" tone="light"
              />
              {error && <ErrorBanner tone="light" message={error} />}
              <BrandButton tone="light" type="submit" loading={busy} disabled={code.trim().length < 6} className="w-full">
                {t('verify')}
              </BrandButton>
              <div className="flex items-center justify-between text-xs">
                <button
                  type="button" onClick={() => { setStep('email'); setSignupFlow(false); setCode(''); setError(null); }}
                  className="min-h-12 underline-offset-2 hover:underline" style={{ color: CP_LIGHT_MUTED }} disabled={busy}
                >
                  {t('changeEmail')}
                </button>
                <button
                  type="button" onClick={() => void requestCode(false)}
                  disabled={busy || resendIn > 0}
                  className="min-h-12 font-medium underline-offset-2 hover:underline disabled:no-underline"
                  style={{ color: resendIn > 0 || busy ? CP_LIGHT_FAINT : CP_GREEN_TEXT }}
                >
                  {resendIn > 0 ? t('resendCountdown', { seconds: resendIn }) : t('resend')}
                </button>
              </div>
            </form>
          )}

          {step === 'cv' && (
            <div className="space-y-4">
              {signupFlow && <StepIndicator current={2} labels={[ts('step1'), ts('step2'), ts('step3')]} />}
              <div className="flex items-center gap-2 text-base font-medium text-[#0D0D0D]">
                <FileText className="size-4" style={{ color: CP_GREEN }} /> {ts('cvStepHeading')}
              </div>
              {cvUploadError ? (
                <>
                  <ErrorBanner tone="light" message={cvUploadError} />
                  <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{ts('cvUploadFailedDesc')}</p>
                  <BrandButton
                    tone="light"
                    type="button" loading={busy} className="w-full"
                    onClick={() => void uploadCv(pinAlreadySet)}
                  >
                    {ts('cvRetry')}
                  </BrandButton>
                  <button
                    type="button" disabled={busy}
                    onClick={() => { setCvFile(null); setCvUploadError(null); afterVerify(pinAlreadySet); }}
                    className="w-full text-center text-xs underline-offset-2 hover:underline"
                    style={{ color: CP_LIGHT_FAINT }}
                  >
                    {ts('cvSkip')}
                  </button>
                </>
              ) : (
                <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{ts('cvUploading')}</p>
              )}
            </div>
          )}

          {step === 'setPin' && (
            <form onSubmit={savePin} className="space-y-4">
              {signupFlow && <StepIndicator current={3} labels={[ts('step1'), ts('step2'), ts('step3')]} />}
              <div className="flex items-center gap-2 text-base font-medium text-[#0D0D0D]">
                <KeyRound className="size-4" style={{ color: CP_GREEN }} /> {ta('setHeading')}
              </div>
              <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{ta('setSubtitle')}</p>
              <div className="space-y-1.5">
                <label htmlFor="cp-pin" className={labelCls} style={{ color: CP_LIGHT_MUTED }}>{ta('pinLabel')}</label>
                <input
                  id="cp-pin" inputMode="numeric" autoComplete="off" dir="ltr"
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={ta('pinPlaceholder')} disabled={busy}
                  className={`${cpInputClassLight} text-center text-lg tracking-[0.4em]`}
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: CP_LIGHT_MUTED }}>
                <input
                  type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                  disabled={busy} className="size-4" style={{ accentColor: CP_GREEN }}
                />
                {ta('rememberDevice')}
              </label>
              {error && <ErrorBanner tone="light" message={error} />}
              <BrandButton tone="light" type="submit" loading={busy} disabled={pin.trim().length < 4} className="w-full">
                {ta('submitSet')}
              </BrandButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
