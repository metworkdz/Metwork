'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';

export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
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
        <p className="text-sm font-medium text-destructive">Error</p>
        <h2 className="text-2xl font-semibold tracking-tight">Something went wrong</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error occurred. Please try again or contact support if the problem persists.
        </p>
        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/60">ID: {error.digest}</p>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </Container>
  );
}
