'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';

export function ClaimGiftButton({ token }: { token: string }) {
  const t = useTranslations('academy.gift');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button size="lg" className="w-full font-bold" disabled={busy} onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const res = await apiClient.post<{ kind: 'COURSE' | 'PASS'; courseSlug: string | null }>('/academy/gifts/claim', { token });
          router.push(res.courseSlug ? `/academy/learn/${res.courseSlug}` : '/academy/courses?pass=1');
        } catch (err) {
          const code = err instanceof ApiClientError ? err.code : '';
          setError(['EXPIRED', 'ALREADY_CLAIMED', 'ALREADY_OWNED', 'RATE_LIMITED'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
          setBusy(false);
        }
      }}>
        {busy && <Loader2 className="me-2 size-4 animate-spin" />}{t('claim')}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
