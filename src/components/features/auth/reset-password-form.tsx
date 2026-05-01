'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, Eye, EyeOff } from 'lucide-react';
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

const errorMessages: Record<string, string> = {
  weakPassword: 'Password must be at least 8 characters with a letter and a number.',
  passwordMismatch: 'Passwords do not match.',
  required: 'This field is required.',
};

function fieldError(message?: string): string | undefined {
  if (!message) return undefined;
  return errorMessages[message] ?? message;
}

interface ResetPasswordFormProps {
  /** The raw token from the URL ?token= query param. */
  token: string;
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

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
          err instanceof Error ? err.message : 'Something went wrong. Please try again.';
        setServerError(
          msg.includes('invalid or has expired')
            ? 'This reset link is invalid or has expired. Please request a new one.'
            : msg,
        );
      }
    });
  }

  if (!token) {
    return (
      <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Invalid link</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This password reset link is missing a token.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link href="/forgot-password">Request a new link</Link>
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
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Password updated!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your password has been changed. You can now sign in with your new password.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background p-5 shadow-sm sm:p-8">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Choose a strong password you haven&apos;t used before.
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          label="New password"
          htmlFor="password"
          error={fieldError(errors.password?.message)}
          required
        >
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="8+ chars, letter & number"
              error={!!errors.password}
              className="pr-10"
              {...register('password')}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 end-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        <FormField
          label="Confirm password"
          htmlFor="confirmPassword"
          error={fieldError(errors.confirmPassword?.message)}
          required
        >
          <div className="relative">
            <Input
              id="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Repeat your new password"
              error={!!errors.confirmPassword}
              className="pr-10"
              {...register('confirmPassword')}
            />
            <button
              type="button"
              tabIndex={-1}
              aria-label={showConfirm ? 'Hide password' : 'Show password'}
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
                Request a new one
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
          Reset password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </div>
  );
}
