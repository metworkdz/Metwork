'use client';

import { useState, useTransition } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations, useLocale } from 'next-intl';
import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link, useRouter } from '@/i18n/routing';
import { signupSchema, type SignupInput } from '@/lib/validators';
import { authService } from '@/services/auth.service';
import { ApiClientError } from '@/lib/api-client';
import { algerianCities, getCityName } from '@/config/cities';
import { SIGNUP_ROLES, type SignupRole } from '@/types/auth';
import { RoleCard } from './role-card';
import type { Locale } from '@/i18n/config';

type Step = 'role' | 'details';

export function SignupForm() {
  const t = useTranslations('auth');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [step, setStep] = useState<Step>('role');
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    mode: 'onBlur',
    defaultValues: {
      role: 'ENTREPRENEUR',
      fullName: '',
      email: '',
      phone: '',
      city: '',
      password: '',
      confirmPassword: '',
      acceptTerms: false as unknown as true,
      acceptPrivacy: false as unknown as true,
      incubatorName: '',
      sex: undefined,
    },
  });

  const selectedRole = watch('role');

  function handleRoleSelect(role: SignupRole) {
    setValue('role', role, { shouldValidate: true });
  }

  async function handleContinue() {
    const ok = await trigger('role');
    if (ok) setStep('details');
  }

  function onSubmit(values: SignupInput) {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const res = await authService.signup(values);
        if (res.requiresOtp) {
          const params = new URLSearchParams({
            userId: res.userId,
            phone: res.maskedPhone,
            email: res.maskedEmail,
          });
          router.push(`/verify-otp?${params.toString()}`);
        } else {
          router.push('/login');
        }
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.code === 'EMAIL_EXISTS') setSubmitError(t('errors.emailExists'));
          else if (err.code === 'PHONE_EXISTS') setSubmitError(t('errors.phoneExists'));
          else setSubmitError(t('errors.networkError'));
        } else {
          setSubmitError(t('errors.networkError'));
        }
      }
    });
  }

  const busy = isSubmitting || isPending;

  // ────────── STEP 1: Role selection ──────────
  if (step === 'role') {
    return (
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t('signup.step1Title')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t('signup.step1Subtitle')}</p>
        </div>

        <div className="space-y-3">
          {SIGNUP_ROLES.map((role) => (
            <RoleCard
              key={role}
              role={role}
              selected={selectedRole === role}
              onSelect={handleRoleSelect}
            />
          ))}
        </div>

        <Button
          type="button"
          onClick={handleContinue}
          className="mt-6 w-full"
          size="lg"
          disabled={!selectedRole}
        >
          {t('signup.continue')}
          <ArrowRight className="ms-1 size-4 rtl:rotate-180" />
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t('signup.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t('signup.loginLink')}
          </Link>
        </p>
      </div>
    );
  }

  // ────────── STEP 2: Details ──────────
  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setStep('role')}
          className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t('signup.back')}
        </button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t('signup.step2Title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('signup.step2Subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('signup.fullNameLabel')}
          htmlFor="fullName"
          error={
            errors.fullName && t(`errors.${errors.fullName.message}` as 'errors.required')
          }
          required
        >
          <Input
            id="fullName"
            autoComplete="name"
            placeholder={t('signup.fullNamePlaceholder')}
            error={!!errors.fullName}
            {...register('fullName')}
          />
        </FormField>

        {/* Organisation name — shown for INCUBATOR and TRAINER providers */}
        {(selectedRole === 'INCUBATOR' || selectedRole === 'TRAINER') && (
          <FormField
            label={
              selectedRole === 'TRAINER'
                ? t('signup.trainerNameLabel')
                : t('signup.incubatorNameLabel')
            }
            htmlFor="incubatorName"
            error={
              errors.incubatorName &&
              t(`errors.${errors.incubatorName.message}` as 'errors.required')
            }
          >
            <Input
              id="incubatorName"
              autoComplete="organization"
              placeholder={
                selectedRole === 'TRAINER'
                  ? t('signup.trainerNamePlaceholder')
                  : t('signup.incubatorNamePlaceholder')
              }
              error={!!errors.incubatorName}
              {...register('incubatorName')}
            />
          </FormField>
        )}

        <FormField
          label={t('signup.emailLabel')}
          htmlFor="email"
          error={errors.email && t(`errors.${errors.email.message}` as 'errors.required')}
          required
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('signup.emailPlaceholder')}
            error={!!errors.email}
            {...register('email')}
          />
        </FormField>

        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <FormField
              label={t('signup.phoneLabel')}
              htmlFor="phone"
              error={errors.phone && t(`errors.${errors.phone.message}` as 'errors.required')}
              required
            >
              <div
                dir="ltr"
                className={`flex overflow-hidden rounded-md border bg-background ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 ${errors.phone ? 'border-destructive' : 'border-input'}`}
              >
                <span className="flex shrink-0 items-center gap-1.5 border-r border-input bg-muted/50 px-3 text-sm text-muted-foreground select-none">
                  🇩🇿 +213
                </span>
                <input
                  id="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="5 50 00 00 00"
                  value={field.value.replace(/^\+213/, '')}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d\s]/g, '');
                    const digits = raw.replace(/\s/g, '');
                    // Strip leading 0 if user pastes local format
                    const normalized = digits.startsWith('0') ? digits.slice(1) : digits;
                    field.onChange(`+213${normalized}`);
                  }}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </FormField>
          )}
        />

        <Controller
          control={control}
          name="city"
          render={({ field }) => (
            <FormField
              label={t('signup.cityLabel')}
              htmlFor="city"
              error={errors.city && t(`errors.${errors.city.message}` as 'errors.required')}
              required
            >
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="city" error={!!errors.city}>
                  <SelectValue placeholder={t('signup.cityPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {algerianCities.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {getCityName(c.code, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
        />

        {/* Sex — shown for ENTREPRENEUR and INVESTOR */}
        {(selectedRole === 'ENTREPRENEUR' || selectedRole === 'INVESTOR') && (
          <Controller
            control={control}
            name="sex"
            render={({ field }) => (
              <FormField
                label={t('signup.sexLabel')}
                htmlFor="sex"
              >
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger id="sex">
                    <SelectValue placeholder={t('signup.sexPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">{t('signup.sexMale')}</SelectItem>
                    <SelectItem value="FEMALE">{t('signup.sexFemale')}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            )}
          />
        )}

        <FormField
          label={t('signup.passwordLabel')}
          htmlFor="password"
          hint={t('signup.passwordHint')}
          error={
            errors.password && t(`errors.${errors.password.message}` as 'errors.required')
          }
          required
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={t('signup.passwordPlaceholder')}
              error={!!errors.password}
              className="pe-10"
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        <FormField
          label={t('signup.confirmPasswordLabel')}
          htmlFor="confirmPassword"
          error={
            errors.confirmPassword &&
            t(`errors.${errors.confirmPassword.message}` as 'errors.required')
          }
          required
        >
          <Input
            id="confirmPassword"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            error={!!errors.confirmPassword}
            {...register('confirmPassword')}
          />
        </FormField>

        <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            {...register('acceptTerms')}
          />
          <span>
            {t.rich('signup.termsAgreement', {
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
        {errors.acceptTerms && (
          <p className="text-xs text-destructive" role="alert">
            {t(`errors.${errors.acceptTerms.message}` as 'errors.termsRequired')}
          </p>
        )}

        {/* Explicit data-processing consent — Law 18-07 */}
        <label className="flex cursor-pointer items-start gap-2 pt-1 text-xs leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
            {...register('acceptPrivacy')}
          />
          <span>
            {t.rich('signup.privacyAgreement', {
              privacyLink: (chunks) => (
                <Link href="/privacy-policy" className="font-medium text-primary hover:underline">
                  {chunks}
                </Link>
              ),
            })}
          </span>
        </label>
        {errors.acceptPrivacy && (
          <p className="text-xs text-destructive" role="alert">
            {t(`errors.${errors.acceptPrivacy.message}` as 'errors.privacyRequired')}
          </p>
        )}

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {busy ? t('signup.submitting') : t('signup.submit')}
        </Button>
      </form>
    </div>
  );
}
