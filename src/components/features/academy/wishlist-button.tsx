'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/** Save a course for later; the learner is told when a new module goes live. */
export function WishlistButton({ courseId, initial }: { courseId: string; initial: boolean }) {
  const t = useTranslations('academy.learning.wishlist');
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button" variant="outline" className="w-full" disabled={busy} aria-pressed={on}
      onClick={async () => {
        setBusy(true);
        try { setOn((await apiClient.post<{ wishlisted: boolean }>('/academy/wishlist', { courseId, on: !on })).wishlisted); }
        catch { /* the button keeps its state */ }
        finally { setBusy(false); }
      }}
    >
      <Heart className={cn('me-1.5 size-4', on && 'fill-current text-rose-500')} aria-hidden />
      {on ? t('saved') : t('save')}
    </Button>
  );
}
