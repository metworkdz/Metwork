'use client';

import { useEffect } from 'react';
import { Container } from '@/components/ui/container';
import { Button } from '@/components/ui/button';
import { recoverFromChunkError } from '@/lib/chunk-recovery';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Loop-guarded reload for a stale chunk; otherwise render the fallback.
    if (recoverFromChunkError(error)) return;

    import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
    // eslint-disable-next-line no-console
    console.error('[global error]', error);
  }, [error]);

  return (
    <html>
      <body>
        <Container size="md" className="py-24 text-center">
          <p className="text-sm font-medium text-destructive">Error</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-3 text-muted-foreground">
            We&apos;ve been notified and are looking into it.
          </p>
          <Button onClick={reset} className="mt-8">
            Try again
          </Button>
        </Container>
      </body>
    </html>
  );
}
