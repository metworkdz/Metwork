/**
 * « Avis » — every program's feedback at a glance: its overall rating, how
 * many answered, whether the form is open. Private to the incubator; each row
 * opens the program's « Avis » tab, where the form is edited and sent.
 */
import { getLocale, getTranslations, setRequestLocale } from 'next-intl/server';
import { ChevronRight } from 'lucide-react';

import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatRating, StarsDisplay } from '@/components/features/feedback/shared';
import { findIncubatorByUserEmail } from '@/server/incubator/service';
import { incubatorScope } from '@/server/registrations/service';
import { getFeedbackOverview, type FeedbackOverviewRow } from '@/server/feedback/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata() {
  const t = await getTranslations('feedback');
  return { title: t('pageTitle') };
}

const STATUS_CLASS: Record<FeedbackOverviewRow['status'], string> = {
  NONE: 'bg-muted text-muted-foreground',
  OPEN: 'bg-primary/15 text-primary',
  CLOSED: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
};

export default async function IncubatorFeedbackPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('feedback');
  const lang = await getLocale();
  const user = await requireRole(['INCUBATOR']);

  const inc = await findIncubatorByUserEmail(user.email);
  const rows = inc ? await getFeedbackOverview(incubatorScope(inc.id)) : [];
  // Rated first (best on top), then programs still collecting, then the rest.
  rows.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1) || a.title.localeCompare(b.title));

  const statusLabel = (s: FeedbackOverviewRow['status']) =>
    s === 'OPEN' ? t('statusOpen') : s === 'CLOSED' ? t('statusClosed') : t('statusDraft');

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('pageSubtitle')} />
      {rows.length === 0 ? (
        <InlineEmptyState title={t('emptyPrograms')} description={t('pageSubtitle')} />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[minmax(0,1fr)_8.5rem_11rem_auto] gap-3 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid">
          <span>{t('colProgram')}</span><span>{t('colRating')}</span><span>{t('colResponses')}</span><span className="w-4" />
        </div>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.programId}>
              <Link
                href={`/dashboard/incubator/programs/${r.programId}?tab=feedback`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_8.5rem_11rem_auto]"
              >
                <span className="min-w-0 space-y-1">
                  <span dir="auto" className="block truncate font-medium">{r.title}</span>
                  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}>{statusLabel(r.status)}</span>
                </span>
                <span className="hidden items-center gap-2 md:flex">
                  {r.overall !== null ? (
                    <>
                      <StarsDisplay value={r.overall} className="text-sm" />
                      <span className="font-semibold tabular-nums">{formatRating(r.overall, lang)}</span>
                    </>
                  ) : <span className="text-muted-foreground">—</span>}
                </span>
                <span className="hidden text-sm text-muted-foreground md:block">
                  {r.sent > 0
                    ? t('responsesOfSent', { count: r.responses, sent: r.sent })
                    : r.responses > 0
                      ? t('responsesCount', { count: r.responses })
                      : t('notSentYet')}
                </span>
                <span className="flex items-center gap-2">
                  {/* On a phone: the rating sits where the columns were. */}
                  {r.overall !== null && <span className="font-semibold tabular-nums md:hidden">★ {formatRating(r.overall, lang)}</span>}
                  <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
