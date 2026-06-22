'use client';

import { useEffect, useState } from 'react';
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

  // TEMP(feat/booking-form-ux): on-device iOS Safari error capture. Append
  // `?debug=1` to the URL, reproduce on the device, and read the message off
  // screen (Sentry is unavailable to the owner). REMOVE once the root cause is
  // confirmed.
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    try {
      setDebug(new URLSearchParams(window.location.search).get('debug') === '1');
    } catch { /* no-op */ }
  }, []);

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
        {/* TEMP(feat/booking-form-ux): remove after confirming the iOS root cause */}
        {debug && (
          <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-3 text-start font-mono text-[11px] text-foreground">
            {error.name}: {error.message}
            {error.digest ? `\ndigest: ${error.digest}` : ''}
            {error.stack ? `\n\n${error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
          </pre>
        )}
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </Container>
  );
}
