'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { recoverFromChunkError } from '@/lib/chunk-recovery';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('pages.error');

  useEffect(() => {
    // Recover a stale-chunk error (post-deploy) with a loop-guarded reload
    // instead of dead-ending on `reset()`. Suppressed reloads fall through to
    // the fallback UI below.
    if (recoverFromChunkError(error)) return;

    // Lazily import Sentry so a missing/unconfigured DSN never crashes the error page itself.
    import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error('[app error]', error);
  }, [error]);

  return (
    <Container size="md">
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm font-medium text-destructive">{t('label')}</p>
        <h2 className="text-2xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t('description')}
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/60">{t('id', { id: error.digest })}</p>
        )}
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </Container>
  );
}
