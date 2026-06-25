'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { MessageCircle, Mail, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter, Link } from '@/i18n/routing';
import { authService } from '@/services/auth.service';
import { bookingService } from '@/services/booking.service';
import { ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import { dashboardPathForRole } from '@/lib/dashboard-routes';
import { cn } from '@/lib/utils';

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

type OtpChannel = 'whatsapp' | 'sms' | 'email';

export function OtpForm() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();

  const userId = searchParams.get('userId') ?? '';
  const phone = searchParams.get('phone') ?? '';
  const email = searchParams.get('email') ?? '';
  // Public-space "book before you sign up": resume the carried selection to
  // payment once the account is verified.
  const bookingIntent = searchParams.get('bookingIntent');

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  // Set when the account was verified but the carried slot is gone / expired.
  const [resumeFailed, setResumeFailed] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN);
  const [lastChannel, setLastChannel] = useState<OtpChannel>('whatsapp');
  const [isPending, startTransition] = useTransition();
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
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
        const session = await authService.verifyOtp({ userId, code });
        await refresh();
        // Public-space flow: resume the carried selection straight to payment.
        // The server re-checks availability + re-prices for the new account.
        if (bookingIntent) {
          try {
            const { payPath } = await bookingService.resumeBookingIntent(bookingIntent);
            window.location.assign(payPath);
            return;
          } catch (resumeErr) {
            // Account is verified, but the slot was taken / the selection expired.
            setResumeFailed(true);
            setError(
              resumeErr instanceof ApiClientError &&
                (resumeErr.code === 'SLOT_UNAVAILABLE' ||
                  resumeErr.code === 'BOOKING_INTENT_EXPIRED')
                ? t('errors.bookingUnavailable')
                : t('errors.networkError'),
            );
            return;
          }
        }
        // "Book & create an account": the server returns a booking-specific
        // destination (pay page for spaces/programs, pending-approval page for
        // consultations). Full navigation — the pay page lives outside the SPA.
        if (session.redirect) {
          window.location.assign(session.redirect);
          return;
        }
        router.push(dashboardPathForRole(session.user.role));
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

  function onResendChannel(channel: OtpChannel) {
    if (!userId) return;
    startTransition(async () => {
      try {
        await authService.resendOtp(userId, channel);
        setLastChannel(channel);
        setCooldown(RESEND_COOLDOWN);
        setError(null);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 429) {
          setError(t('errors.tooManyAttempts'));
        } else {
          setError(t('errors.networkError'));
        }
      }
    });
  }

  const channels: { channel: OtpChannel; label: string; Icon: typeof MessageCircle }[] = [
    { channel: 'whatsapp', label: t('verifyOtp.channelWhatsapp'), Icon: MessageCircle },
    { channel: 'email',    label: t('verifyOtp.channelEmail'),    Icon: Mail           },
    { channel: 'sms',      label: t('verifyOtp.channelSms'),      Icon: MessageSquare  },
  ];

  // Account verified, but the carried space slot is gone / the selection expired.
  if (resumeFailed) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 text-center shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{t('verifyOtp.accountReadyTitle')}</h1>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button asChild className="mt-5 w-full" size="lg">
          <Link href="/spaces">{t('verifyOtp.browseSpaces')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('verifyOtp.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {email
            ? t('verifyOtp.subtitleWithEmail', { phone, email })
            : t('verifyOtp.subtitle', { phone })}
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

      {/* Resend / channel switcher */}
      <div className="mt-6">
        {cooldown > 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            {t('verifyOtp.resendIn', { seconds: cooldown })}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-center text-xs font-medium text-muted-foreground">
              {t('verifyOtp.didntReceive')}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {channels.map(({ channel, label, Icon }) => (
                <button
                  key={channel}
                  type="button"
                  onClick={() => onResendChannel(channel)}
                  disabled={isPending}
                  className={cn(
                    'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                    'hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700',
                    channel === lastChannel
                      ? 'border-primary-200 bg-primary-50 text-primary-700'
                      : 'border-border bg-background text-muted-foreground',
                    isPending && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
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
