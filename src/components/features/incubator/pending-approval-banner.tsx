'use client';

/**
 * Persistent banner shown on the incubator dashboard home while the incubator
 * account is still PENDING admin approval. Dismissible once per browser session
 * (sessionStorage) — it returns on the next session until the account is
 * approved, at which point the server stops rendering it entirely.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Clock, X } from 'lucide-react';

const DISMISS_KEY = 'metwork.incubatorPendingBanner.dismissed';

export function IncubatorPendingApprovalBanner() {
  const t = useTranslations('incubator.pendingBanner');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(sessionStorage.getItem(DISMISS_KEY) !== '1');
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <Clock className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="mt-0.5 text-sm">{t('description')}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          sessionStorage.setItem(DISMISS_KEY, '1');
          setVisible(false);
        }}
        aria-label={t('dismiss')}
        className="shrink-0 rounded-md p-1 text-amber-700 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
