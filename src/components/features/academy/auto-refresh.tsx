'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';

/** Re-render the server page every few seconds (payment still being confirmed). Stops after ~2 minutes. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n * seconds > 120) clearInterval(id);
      else router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
