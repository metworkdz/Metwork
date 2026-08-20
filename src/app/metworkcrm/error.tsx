'use client';

import { useEffect } from 'react';
import { CrmButton } from '@/components/metworkcrm/ui/button';

/**
 * CRM-scoped error boundary. Never surfaces the raw message — an internal tool
 * still shouldn't leak stack details into the DOM. `digest` is the server-side
 * correlation id for the logs.
 */
export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[metworkcrm] unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-[var(--crm-black)]">Une erreur est survenue</h1>
      <p className="mt-2 max-w-md text-sm text-neutral-500">
        Impossible d’afficher cette page. Réessayez, et si le problème persiste, signalez-le à
        l’équipe technique.
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-neutral-400">Réf. {error.digest}</p>
      ) : null}
      <CrmButton onClick={reset} className="mt-6">
        Réessayer
      </CrmButton>
    </div>
  );
}
