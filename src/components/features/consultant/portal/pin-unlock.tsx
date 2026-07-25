'use client';

/**
 * Trusted-device PIN unlock. Shown at /mentordashboard when a remembered-device
 * cookie is present but there is no live session. The device cookie identifies
 * the mentor server-side; the PIN authenticates. After too many wrong PINs (or
 * if the device is no longer trusted) the user falls back to full email → OTP.
 *
 * No client storage: the PIN is posted and never persisted; the device trust is
 * an HttpOnly cookie set server-side. Light, centered-card surface — matches
 * the login/signup page.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { ApiClientError } from '@/lib/api-client';
import { consultantService } from '@/services/consultant.service';
import {
  AppLogo, BrandButton, CP_GREEN, CP_GREEN_TINT, CP_LIGHT_BORDER, CP_LIGHT_MUTED, ErrorBanner, GhostButton,
  Spinner, cpInputClassLight,
} from './shared';

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

export function PinUnlock({ onUnlocked }: { onUnlocked: () => void }) {
  const t = useTranslations('consultantPortal.access');
  const tSign = useTranslations('consultantPortal.signin');

  const [trusted, setTrusted] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    consultantService.unlockState()
      .then((d) => { if (!cancelled) setTrusted(d.trusted); })
      .catch(() => { if (!cancelled) setTrusted(false); });
    return () => { cancelled = true; };
  }, []);

  const toEmail = useCallback(() => { window.location.assign('/mentordashboard/login'); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await consultantService.unlockPin(pin.trim());
      onUnlocked();
    } catch (err) {
      if (err instanceof ApiClientError) {
        if (err.code === 'WRONG_PIN') setError(t('wrongPin'));
        else if (err.code === 'INVALID_PIN_FORMAT') setError(t('invalidFormat'));
        else if (err.code === 'RATE_LIMITED') setError(t('lockedFallback'));
        else if (err.code === 'DEVICE_NOT_TRUSTED') setTrusted(false);
        else setError(t('errorGeneric'));
      } else {
        setError(t('errorGeneric'));
      }
    } finally {
      setBusy(false);
    }
  }

  if (trusted === null) {
    return (
      <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center">
        <Spinner tone="light" />
      </div>
    );
  }

  if (!trusted) {
    return (
      <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-sm">
          <BrandHeader tagline={tSign('tagline')} />
          <div
            className="space-y-4 rounded-3xl border bg-white p-5 text-center sm:p-7"
            style={{ borderColor: CP_LIGHT_BORDER, boxShadow: '0 20px 60px -20px rgba(13,13,13,0.12), 0 2px 8px rgba(13,13,13,0.04)' }}
          >
            <ShieldAlert className="mx-auto size-9 text-amber-500" />
            <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('deviceNotTrusted')}</p>
            <BrandButton tone="light" onClick={toEmail} className="w-full">{t('useEmailInstead')}</BrandButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-64px)] items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-sm">
        <BrandHeader tagline={t('unlockTagline')} />
        <div
          className="space-y-4 rounded-3xl border bg-white p-5 sm:p-7"
          style={{ borderColor: CP_LIGHT_BORDER, boxShadow: '0 20px 60px -20px rgba(13,13,13,0.12), 0 2px 8px rgba(13,13,13,0.04)' }}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-[#0D0D0D]">
            <KeyRound className="size-4" style={{ color: CP_GREEN }} /> {t('enterHeading')}
          </div>
          <p className="text-sm" style={{ color: CP_LIGHT_MUTED }}>{t('enterSubtitle')}</p>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="cp-pin" className="text-xs font-medium" style={{ color: CP_LIGHT_MUTED }}>{t('pinLabel')}</label>
              <input
                id="cp-pin" inputMode="numeric" autoComplete="off" dir="ltr"
                value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder={t('pinPlaceholder')} disabled={busy}
                className={`${cpInputClassLight} text-center text-lg tracking-[0.4em]`}
              />
            </div>
            {error && <ErrorBanner tone="light" message={error} />}
            <BrandButton tone="light" type="submit" loading={busy} disabled={pin.trim().length < 4} className="w-full">
              {t('submitEnter')}
            </BrandButton>
            <GhostButton tone="light" type="button" onClick={toEmail} className="w-full text-xs">
              {t('useEmailInstead')}
            </GhostButton>
          </form>
        </div>
      </div>
    </div>
  );
}
