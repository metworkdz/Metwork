'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { useRouter, Link } from '@/i18n/routing';
import { authService } from '@/services/auth.service';
import { ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { cn } from '@/lib/utils';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

export function OtpForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();

  const userId = searchParams.get('userId') ?? '';
  const phone = searchParams.get('phone') ?? '';

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [isPending, startTransition] = useTransition();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function setDigit(index: number, value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    if (cleaned && index < OTP_LENGTH - 1) {
      inputs.current[index + 1]?.focus();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = pasted.split('').concat(Array(OTP_LENGTH).fill('')).slice(0, OTP_LENGTH);
    setDigits(next);
    inputs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  }

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const code = digits.join('');
    if (code.length !== OTP_LENGTH) return;

    startTransition(async () => {
      try {
        await authService.verifyOtp({ userId, code });
        await refresh();
        router.push('/dashboard/entrepreneur');
        router.refresh();
      } catch (err) {
        if (err instanceof ApiClientError && (err.code === 'INVALID_OTP' || err.status === 400)) {
          setError(t('errors.invalidOtp'));
        } else if (err instanceof ApiClientError && err.status === 429) {
          setError(t('errors.tooManyAttempts'));
        } else {
          setError(t('errors.networkError'));
        }
        setDigits(Array(OTP_LENGTH).fill(''));
        inputs.current[0]?.focus();
      }
    });
  }

  // Auto-submit when all digits filled
  useEffect(() => {
    if (digits.every((d) => d !== '') && !isPending) {
      onSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  function onResend() {
    if (cooldown > 0 || !userId) return;
    startTransition(async () => {
      try {
        await authService.resendOtp(userId);
        setCooldown(RESEND_COOLDOWN);
        setError(null);
      } catch {
        setError(t('errors.networkError'));
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('verifyOtp.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('verifyOtp.subtitle', { phone })}
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <fieldset>
          <legend className="sr-only">{t('verifyOtp.codeLabel')}</legend>
          <div className="flex justify-center gap-2" dir="ltr">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                pattern="\d{1}"
                maxLength={1}
                aria-label={`Digit ${i + 1}`}
                value={digit}
                onChange={(e) => setDigit(i, e.target.value)}
                onPaste={onPaste}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={cn(
                  'size-12 rounded-md border border-input bg-background text-center text-lg font-semibold shadow-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  error && 'border-destructive',
                )}
              />
            ))}
          </div>
        </fieldset>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
          >
            {error}
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" loading={isPending}>
          {t('verifyOtp.submit')}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm">
        {cooldown > 0 ? (
          <span className="text-muted-foreground">
            {t('verifyOtp.resendIn', { seconds: cooldown })}
          </span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            className="font-medium text-primary hover:underline"
          >
            {t('verifyOtp.resend')}
          </button>
        )}
      </div>

      <div className="mt-4 text-center">
        <Link
          href="/signup"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('verifyOtp.wrongNumber')}
        </Link>
      </div>
    </div>
  );
}
