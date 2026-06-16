'use client';

/**
 * Inline account-creation fields shown when a GUEST chooses
 * "Book & create an account" on a space / program / consultation booking.
 *
 * It collects only the extra data needed to register an account on top of the
 * contact details (name / email / phone) the booking form already gathers:
 *   - password + confirm  (reuses the platform's strong-password rule)
 *   - city                (required by the existing signup path)
 *   - Terms + Privacy (Law 18-07) consent
 *
 * No card data is ever collected here — payment happens later on the hosted
 * checkout page. The parent owns the state so it can validate and submit; the
 * account itself is created server-side via the existing signup helpers.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/routing';
import { strongPasswordRegex } from '@/lib/validators';
import { algerianCities, getCityName } from '@/config/cities';
import type { Locale } from '@/i18n/config';

export interface BookingAccountDraft {
  password: string;
  confirmPassword: string;
  city: string;
  acceptTerms: boolean;
  acceptPrivacy: boolean;
}

export const emptyBookingAccount: BookingAccountDraft = {
  password: '',
  confirmPassword: '',
  city: '',
  acceptTerms: false,
  acceptPrivacy: false,
};

/**
 * Lightweight client-side validity check. The server re-validates
 * authoritatively (password policy, conflicts) before any account is created.
 */
export function isBookingAccountValid(a: BookingAccountDraft): boolean {
  return (
    strongPasswordRegex.test(a.password) &&
    a.password === a.confirmPassword &&
    a.city.trim().length > 0 &&
    a.acceptTerms &&
    a.acceptPrivacy
  );
}

export function BookingCreateAccountFields({
  value,
  onChange,
  disabled,
  idPrefix = 'acct',
}: {
  value: BookingAccountDraft;
  onChange: (next: BookingAccountDraft) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const t = useTranslations('booking.createAccount');
  const locale = useLocale() as Locale;
  const [showPassword, setShowPassword] = useState(false);

  const set = <K extends keyof BookingAccountDraft>(key: K, v: BookingAccountDraft[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div>
        <p className="text-sm font-semibold">{t('panelTitle')}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('panelSubtitle')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Password */}
        <div>
          <Label htmlFor={`${idPrefix}-password`}>{t('password')}</Label>
          <div className="relative mt-1.5">
            <Input
              id={`${idPrefix}-password`}
              type={showPassword ? 'text' : 'password'}
              value={value.password}
              onChange={(e) => set('password', e.target.value)}
              disabled={disabled}
              autoComplete="new-password"
              className="pe-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {/* Confirm password */}
        <div>
          <Label htmlFor={`${idPrefix}-confirm`}>{t('confirmPassword')}</Label>
          <Input
            id={`${idPrefix}-confirm`}
            type={showPassword ? 'text' : 'password'}
            className="mt-1.5"
            value={value.confirmPassword}
            onChange={(e) => set('confirmPassword', e.target.value)}
            disabled={disabled}
            autoComplete="new-password"
            error={value.confirmPassword.length > 0 && value.confirmPassword !== value.password}
            required
          />
        </div>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{t('passwordHint')}</p>

      {/* City */}
      <div>
        <Label htmlFor={`${idPrefix}-city`}>{t('city')}</Label>
        <Select value={value.city} onValueChange={(v) => set('city', v)} disabled={disabled}>
          <SelectTrigger id={`${idPrefix}-city`} className="mt-1.5">
            <SelectValue placeholder={t('cityPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {algerianCities.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {getCityName(c.code, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Consent — Terms + Privacy (Law 18-07) */}
      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          checked={value.acceptTerms}
          onChange={(e) => set('acceptTerms', e.target.checked)}
          disabled={disabled}
        />
        <span>
          {t.rich('terms', {
            termsLink: (chunks) => (
              <Link href="/terms" className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
            privacyLink: (chunks) => (
              <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
          checked={value.acceptPrivacy}
          onChange={(e) => set('acceptPrivacy', e.target.checked)}
          disabled={disabled}
        />
        <span>
          {t.rich('privacy', {
            privacyLink: (chunks) => (
              <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
                {chunks}
              </Link>
            ),
          })}
        </span>
      </label>
    </div>
  );
}

/**
 * Map a client-side draft to a translated error message, or null if valid.
 * `t` is the `booking.createAccount` translator from the calling form.
 */
export function bookingAccountError(
  a: BookingAccountDraft,
  t: (key: string) => string,
): string | null {
  if (!strongPasswordRegex.test(a.password)) return t('errorWeakPassword');
  if (a.password !== a.confirmPassword) return t('errorMismatch');
  if (!a.city.trim()) return t('errorCity');
  if (!a.acceptTerms || !a.acceptPrivacy) return t('errorConsent');
  return null;
}
