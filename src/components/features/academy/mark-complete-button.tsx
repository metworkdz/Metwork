'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';

export function MarkCompleteButton({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const t = useTranslations('academy.player');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await apiClient.post('/academy/progress', { courseId, lessonId }); router.refresh(); } finally { setBusy(false); }
    }}>
      {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Check className="me-1 size-4" />}{t('markComplete')}
    </Button>
  );
}
