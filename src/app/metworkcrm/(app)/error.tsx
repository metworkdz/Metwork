'use client';

import { useEffect } from 'react';
import { CrmButton } from '@/components/metworkcrm/ui/button';

/**
 * Error boundary for the authenticated `(app)` group.
 *
 * Why this exists when `src/app/metworkcrm/error.tsx` already catches
 * everything below it: boundaries nest, and the CLOSEST one wins. Without this
 * file a failing page unmounts the whole CRM tree — sidebar, header, search and
 * notification bell included — leaving the user on a bare page with no
 * navigation and no way out but the browser's back button. Because this
 * boundary sits INSIDE `(app)/layout.tsx`, the shell keeps rendering and only
 * the page area is replaced, so the sidebar stays usable.
 *
 * The parent boundary is still the right place for anything that breaks the
 * shell itself; it is not redundant with this one.
 *
 * Same disclosure posture as the parent: never render the raw message — an
 * internal tool still shouldn't leak stack details into the DOM. `digest` is
 * the server-side correlation id for the logs.
 */
export default function CrmAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[metworkcrm] unhandled page error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-[var(--crm-black)]">Une erreur est survenue</h1>
      <p className="mt-2 max-w-md text-sm text-neutral-500">
        Impossible d’afficher cette page. Réessayez, ou naviguez vers un autre module depuis le
        menu. Si le problème persiste, signalez-le à l’équipe technique.
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
