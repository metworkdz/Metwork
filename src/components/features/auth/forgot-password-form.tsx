'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField } from '@/components/ui/form-field';
import { Link } from '@/i18n/routing';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/lib/validators';
import { authService } from '@/services/auth.service';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const [submitted, setSubmitted] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  function onSubmit(values: ForgotPasswordInput) {
    setError(null);
    startTransition(async () => {
      try {
        await authService.forgotPassword(values);
        setSubmitted(true);
      } catch {
        // Always show success to prevent email enumeration.
        setSubmitted(true);
      }
    });
  }

  if (submitted) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary-100 text-primary-600">
            <CheckCircle2 className="size-6" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            If an account exists for that email, we&apos;ve sent reset instructions.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/login">{t('login.submit')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t('login.forgotPassword')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter the email associated with your account.
        </p>
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

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          loading={isSubmitting || isPending}
        >
          Send reset link
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          ← {tCommon('cancel')}
        </Link>
      </p>
    </div>
  );
}
