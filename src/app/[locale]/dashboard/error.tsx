'use client';

/**
 * Error boundary for the entire /[locale]/dashboard segment.
 *
 * Catches errors thrown by any dashboard page or its child Server
 * Components and renders inside the dashboard layout, so the sidebar
 * stays usable — the user can navigate away to a working page instead
 * of getting bounced to the global error screen.
 *
 * Errors are forwarded to Sentry when configured. The `digest` is shown
 * to the user so they can quote it to support — it's the same hash
 * Vercel's runtime logs use, making correlation trivial.
 */

import { useEffect } from 'react';
import { AlertCircle, RotateCw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { recoverFromChunkError } from '@/lib/chunk-recovery';

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    // A stale chunk after a deploy (common in the long-lived standalone PWA)
    // can't be fixed by `reset()` — only a fresh document recovers it. Try a
    // loop-guarded hard reload first; if it's suppressed (cooldown) we fall
    // through and render the fallback UI below so the user isn't stuck.
    if (recoverFromChunkError(error)) return;

    // Lazy-import Sentry so a missing/unconfigured DSN never crashes the
    // error UI itself — the recovery path must always render.
    import('@sentry/nextjs')
      .then((Sentry) => Sentry.captureException(error))
      .catch(() => undefined);
    // Visible in the browser console too — useful when Sentry isn't wired.
    // eslint-disable-next-line no-console
    console.error('[dashboard error]', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="size-6" />
        </div>
        <h2 className="mt-4 text-lg font-semibold tracking-tight">
          Something went wrong
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn&apos;t load this page. The error has been reported and
          we&apos;re looking into it. You can try again, or head back to
          the dashboard home.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground/60">
            Reference: {error.digest}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} className="gap-1.5">
            <RotateCw className="size-4" />
            Try again
          </Button>
          <Button asChild variant="outline" className="gap-1.5">
            <Link href="/">
              <Home className="size-4" />
              Go home
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
