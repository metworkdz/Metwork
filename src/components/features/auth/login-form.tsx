'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Link, useRouter } from '@/i18n/routing';
import { loginSchema, type LoginInput } from '@/lib/validators';
import { authService } from '@/services/auth.service';
import { ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/providers/auth-provider';
import type { UserRole } from '@/types/auth';

const DASHBOARD_BY_ROLE: Record<UserRole, string> = {
  ADMIN: '/dashboard/admin',
  ENTREPRENEUR: '/dashboard/entrepreneur',
  INVESTOR: '/dashboard/investor',
  INCUBATOR: '/dashboard/incubator',
};

export function LoginForm() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { refresh } = useAuth();
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  function onSubmit(values: LoginInput) {
    setSubmitError(null);
    startTransition(async () => {
      try {
        const session = await authService.login(values);
        await refresh();
        router.push(DASHBOARD_BY_ROLE[session.user.role] ?? '/dashboard/entrepreneur');
      } catch (err) {
        if (err instanceof ApiClientError) {
          if (err.status === 401) setSubmitError(t('errors.invalidCredentials'));
          else if (err.status === 429) setSubmitError(t('errors.tooManyAttempts'));
          else setSubmitError(t('errors.networkError'));
        } else {
          setSubmitError(t('errors.networkError'));
        }
      }
    });
  }

  const busy = isSubmitting || isPending;

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('login.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('login.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label={t('login.emailLabel')}
          htmlFor="email"
          error={errors.email && t(`errors.${errors.email.message}` as 'errors.required')}
          required
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t('login.emailPlaceholder')}
            error={!!errors.email}
            {...register('email')}
          />
        </FormField>

        <FormField
          label={t('login.passwordLabel')}
          htmlFor="password"
          error={errors.password && t(`errors.${errors.password.message}` as 'errors.required')}
          required
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder={t('login.passwordPlaceholder')}
              error={!!errors.password}
              {...register('password')}
              className="pe-10"
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

        <div className="flex items-center justify-between">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 rounded border-input text-primary focus:ring-2 focus:ring-ring"
              {...register('rememberMe')}
            />
            {t('login.rememberMe')}
          </label>
          <Link
            href="/forgot-password"
            className="text-sm font-medium text-primary hover:underline"
          >
            {t('login.forgotPassword')}
          </Link>
        </div>

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {submitError}
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" loading={busy}>
          {busy ? t('login.submitting') : t('login.submit')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t('login.noAccount')}{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          {t('login.signupLink')}
        </Link>
      </p>
    </div>
  );
}
