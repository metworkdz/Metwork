'use client';

import { useEffect } from 'react';
import { isChunkLoadError, attemptChunkReload } from '@/lib/chunk-recovery';

/**
 * Global net for chunk-load failures that escape React's error boundaries —
 * e.g. a failed route prefetch, a lazy import fired from an event handler, or
 * a rejected dynamic-import promise. Render-phase chunk errors are handled by
 * the route `error.tsx` boundaries; this covers the rest.
 *
 * Reloads are loop-guarded (see `attemptChunkReload`). Renders nothing.
 */
export function ChunkErrorRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      if (isChunkLoadError(event.error) || isChunkLoadError(event)) {
        attemptChunkReload();
      }
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadError(event.reason)) {
        attemptChunkReload();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
