'use client';

/**
 * Persistent, dismissible-but-recurring banner shown to accounts that are not
 * yet approved (PENDING or REJECTED gated roles). It tells the user they have
 * read-only access. Dismissing hides it for the current view; it reappears on
 * the next navigation/reload so the constraint stays visible.
 *
 * Mounted once in the dashboard layout — renders nothing for approved accounts,
 * entrepreneurs and admins.
 */
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Clock, X } from 'lucide-react';
import { useAuth } from '@/components/providers/auth-provider';

export function PendingApprovalBanner() {
  const { user } = useAuth();
  const t = useTranslations('accountApproval');
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  // Recur on navigation: every route change re-shows the banner.
  useEffect(() => {
    setDismissed(false);
  }, [pathname]);

  const status = user?.approvalStatus ?? 'APPROVED';
  if (!user || status === 'APPROVED' || dismissed) return null;

  const rejected = status === 'REJECTED';
  const tone = rejected
    ? 'border-destructive/30 bg-destructive/10 text-destructive'
    : 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';

  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`}
    >
      <Clock className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{rejected ? t('bannerRejectedTitle') : t('bannerTitle')}</p>
        <p className="mt-0.5 opacity-90">{rejected ? t('bannerRejectedDescription') : t('bannerDescription')}</p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('dismiss')}
        className="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
