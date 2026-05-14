'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Link } from '@/i18n/routing';
import { authService } from '@/services/auth.service';

/* ─── Local schema (mirrors server resetPasswordRequestSchema) ─── */

const schema = z
  .object({
    password: z
      .string()
      .min(8, { message: 'weakPassword' })
      .regex(/^(?=.*[A-Za-z])(?=.*\d).{8,}$/, { message: 'weakPassword' }),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ['confirmPassword'],
    message: 'passwordMismatch',
  });

type FormValues = z.infer<typeof schema>;

interface ResetPasswordFormProps {
  /** The raw token from the URL ?token= query param. */
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const t = useTranslations('auth.resetPassword');
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const errorMessages: Record<string, string> = {
    weakPassword: t('errorWeakPassword'),
    passwordMismatch: t('errorPasswordMismatch'),
    required: t('errorRequired'),
  };

  function fieldError(message?: string): string | undefined {
    if (!message) return undefined;
    return errorMessages[message] ?? message;
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  function onSubmit(values: FormValues) {
    setServerError(null);
    startTransition(async () => {
      try {
        await authService.resetPassword({
          token,
          password: values.password,
          confirmPassword: values.confirmPassword,
        });
        setSuccess(true);
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : t('errorGeneric');
        setServerError(
          msg.includes('invalid or has expired')
            ? t('errorLinkExpired')
            : msg,
        );
      }
    });
  }

  if (!token) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t('invalidLinkTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('invalidLinkDescription')}
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/forgot-password">{t('requestNewLink')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
            <CheckCircle2 className="size-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t('successTitle')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('successDescription')}
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/login">{t('signIn')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('newPasswordLabel')}
          htmlFor="password"
          error={fieldError(errors.password?.message)}
          required
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={t('newPasswordPlaceholder')}
              error={!!errors.password}
              className="pr-10"
              {...register('password')}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showPassword ? t('hidePassword') : t('showPassword')}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        <FormField
          label={t('confirmPasswordLabel')}
          htmlFor="confirmPassword"
          error={fieldError(errors.confirmPassword?.message)}
          required
        >
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={t('confirmPasswordPlaceholder')}
              error={!!errors.confirmPassword}
              className="pr-10"
              {...register('confirmPassword')}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showConfirm ? t('hidePassword') : t('showPassword')}
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            >
              {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {serverError}{' '}
            {serverError.includes('expired') && (
              <Link href="/forgot-password" className="font-medium underline underline-offset-2">
                {t('requestNewOne')}
              </Link>
            )}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={isSubmitting || isPending}
        >
          {t('submitButton')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('backToSignIn')}
        </Link>
      </p>
    </div>
  );
}
