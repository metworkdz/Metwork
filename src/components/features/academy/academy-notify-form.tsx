'use client';

/**
 * AcademyNotifyForm — "get notified when courses launch" email capture for the
 * Startup Academy coming-soon page.
 *
 * No new backend: this reuses the existing public POST /api/contact endpoint
 * (rate-limited, stores to contactSubmissions, emails admin). The waitlist
 * email lands in Admin → Contacts, tagged by the message text below.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Internal marker so admins can tell Academy waitlist leads apart in the inbox. */
const WAITLIST_NAME = 'Academy waitlist';
const WAITLIST_MESSAGE =
  'Startup Academy launch waitlist — please notify this email when courses go live.';

type FormState = 'idle' | 'submitting' | 'success' | 'error';

export function AcademyNotifyForm({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const t = useTranslations('pages.academy');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  const dark = variant === 'dark';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(t('notifyInvalidEmail'));
      return;
    }

    setState('submitting');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: WAITLIST_NAME, email: value, message: WAITLIST_MESSAGE }),
      });

      if (res.status === 429) {
        setError(t('notifyRateLimited'));
        setState('idle');
        return;
      }
      if (!res.ok) {
        setError(t('notifyError'));
        setState('idle');
        return;
      }
      setState('success');
    } catch {
      setError(t('notifyError'));
      setState('idle');
    }
  }

  if (state === 'success') {
    return (
      <div
        className={cn(
          'mx-auto flex max-w-md items-center justify-center gap-3 rounded-xl border px-5 py-4 text-sm font-medium',
          dark
            ? 'border-white/15 bg-white/5 text-white'
            : 'border-primary-200 bg-primary-50 text-primary-800',
        )}
      >
        <CheckCircle2 className={cn('size-5 shrink-0', dark ? 'text-primary-300' : 'text-primary-600')} />
        <span>{t('notifySuccess')}</span>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto w-full max-w-md">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('notifyPlaceholder')}
          aria-label={t('notifyEmailLabel')}
          disabled={state === 'submitting'}
          className={cn(
            'h-12 flex-1 rounded-full px-5',
            dark &&
              'border-white/20 bg-white/10 text-white placeholder:text-white/50 focus-visible:ring-white/40',
          )}
        />
        <Button
          type="submit"
          size="lg"
          loading={state === 'submitting'}
          className="group h-12 shrink-0 rounded-full px-7 text-sm font-bold uppercase tracking-wider"
        >
          {t('notifySubmit')}
          <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-1 rtl:rotate-180 rtl:group-hover:-translate-x-1" />
        </Button>
      </div>

      {error && (
        <p className={cn('mt-2.5 text-center text-sm', dark ? 'text-red-300' : 'text-destructive')}>
          {error}
        </p>
      )}
      <p className={cn('mt-3 text-center text-xs', dark ? 'text-white/50' : 'text-muted-foreground')}>
        {t('notifyPrivacy')}
      </p>
    </form>
  );
}
