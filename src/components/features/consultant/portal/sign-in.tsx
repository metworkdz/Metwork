'use client';

/**
 * Consultant sign-in. Two coexisting paths:
 *   • Durable access link + PIN (primary) — when the URL carries `?token=…`,
 *     we resolve it and show "set your PIN" (first time) or "enter your PIN".
 *     A remembered device can resume without typing the PIN.
 *   • Email magic link (fallback) — the original flow, shown when there is no
 *     token. Both mint the same consultant session.
 *
 * No client storage: the PIN is never persisted; "remember this device" is an
 * HttpOnly cookie set server-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService } from '@/services/consultant.service';
import { AppLogo, BrandButton, CP_GLOW, CP_GREEN, ErrorBanner, Spinner, cpInputClass } from './shared';

interface SignInProps {
  token: string | null;
  errorCode: string | null;
  locale: string;
  onSignedIn: () => void;
}

export function SignIn({ token, errorCode, locale, onSignedIn }: SignInProps) {
  if (token) return <PinSignIn token={token} onSignedIn={onSignedIn} />;
  return <MagicLinkSignIn errorCode={errorCode} locale={locale} />;
}

/* ─────────────────────────── Brand header ─────────────────────────── */

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

/* ─────────────────────────── Magic link ─────────────────────────── */

function MagicLinkSignIn({ errorCode, locale }: { errorCode: string | null; locale: string }) {
  const t = useTranslations('consultantPortal.signin');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await consultantService.requestLink(email.trim(), locale);
      setSent(true);
    } catch {
      setSent(true); // never reveal whether the email matched
    } finally {
      setSending(false);
    }
  }

  const errorMsg = errorCode
    ? ({ invalid: t('errorInvalid'), expired: t('errorExpired'), consumed: t('errorConsumed') } as Record<string, string>)[errorCode] ?? t('errorGeneric')
    : null;

  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <BrandHeader tagline={t('tagline')} />
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        {sent ? (
          <div className="space-y-2 py-4 text-center">
            <CheckCircle2 className="mx-auto size-10" style={{ color: CP_GREEN }} />
            <p className="font-medium text-white">{t('sent')}</p>
            <p className="text-sm text-white/50">{t('sentDesc')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Mail className="size-4" style={{ color: CP_GREEN }} /> {t('heading')}
            </div>
            <p className="text-sm text-white/50">{t('subtitle')}</p>
            {errorMsg && <ErrorBanner message={errorMsg} />}
            <div className="space-y-1.5">
              <label htmlFor="cp-email" className="text-xs font-medium text-white/70">{t('emailLabel')}</label>
              <input
                id="cp-email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('emailPlaceholder')} dir="ltr" disabled={sending}
                className={cpInputClass}
              />
            </div>
            <BrandButton type="submit" loading={sending} className="w-full">{t('submit')}</BrandButton>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-white/40">
              <ShieldCheck className="size-3.5" /> {t('secureNote')}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── PIN ─────────────────────────── */

function PinSignIn({ token, onSignedIn }: { token: string; onSignedIn: () => void }) {
  const t = useTranslations('consultantPortal.access');
  const tSign = useTranslations('consultantPortal.signin');
  const [info, setInfo] = useState<{ valid: boolean; pinSet: boolean; deviceRemembered?: boolean } | null>(null);
  const [pin, setPin] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    consultantService.pinInfo(token)
      .then((d) => { if (!cancelled) setInfo(d); })
      .catch(() => { if (!cancelled) setInfo({ valid: false, pinSet: false }); });
    return () => { cancelled = true; };
  }, [token]);

  const mapError = useCallback((err: unknown): string => {
    if (err instanceof ApiClientError) {
      switch (err.code) {
        case 'WRONG_PIN': return t('wrongPin');
        case 'INVALID_PIN_FORMAT': return t('invalidFormat');
        case 'RATE_LIMITED': return t('rateLimited');
        case 'INVALID_ACCESS': return t('invalidLink');
        default: return t('errorGeneric');
      }
    }
    return t('errorGeneric');
  }, [t]);

  async function submit(withPin: boolean) {
    setBusy(true); setError(null);
    try {
      await consultantService.pinSubmit({
        token,
        pin: withPin ? pin.trim() : undefined,
        rememberDevice: withPin ? remember : undefined,
      });
      onSignedIn();
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <div className="py-16"><Spinner /></div>;

  if (!info.valid) {
    return (
      <div className="mx-auto w-full max-w-sm py-10">
        <BrandHeader tagline={tSign('tagline')} />
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
          <ErrorBanner message={t('invalidLink')} />
        </div>
      </div>
    );
  }

  const isSet = info.pinSet;

  return (
    <div className="mx-auto w-full max-w-sm py-10">
      <BrandHeader tagline={tSign('tagline')} />
      <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.035] p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-white">
          <KeyRound className="size-4" style={{ color: CP_GREEN }} />
          {isSet ? t('enterHeading') : t('setHeading')}
        </div>
        <p className="text-sm text-white/50">{isSet ? t('enterSubtitle') : t('setSubtitle')}</p>

        {info.deviceRemembered && isSet && (
          <BrandButton onClick={() => submit(false)} loading={busy} className="w-full">
            {t('submitEnter')}
          </BrandButton>
        )}

        <form
          onSubmit={(e) => { e.preventDefault(); void submit(true); }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="cp-pin" className="text-xs font-medium text-white/70">{t('pinLabel')}</label>
            <input
              id="cp-pin" inputMode="numeric" autoComplete="off" dir="ltr"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('pinPlaceholder')} disabled={busy}
              className={`${cpInputClass} text-center text-lg tracking-[0.4em]`}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
            <input
              type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
              disabled={busy} className="size-4 accent-[#2ECC71]"
            />
            {t('rememberDevice')}
          </label>
          {error && <ErrorBanner message={error} />}
          <BrandButton type="submit" loading={busy} disabled={pin.trim().length < 4} className="w-full">
            {isSet ? t('submitEnter') : t('submitSet')}
          </BrandButton>
        </form>
      </div>
    </div>
  );
}
