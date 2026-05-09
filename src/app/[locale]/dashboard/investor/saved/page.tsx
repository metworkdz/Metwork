import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { Bookmark } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { StartupMarketplace } from '@/components/features/investor/startup-marketplace';
import { db } from '@/server/db/store';
import { toStartupDto } from '@/server/startups/serialize';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorSavedPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await getLocale() as Locale;
  const user = await requireRole(['INVESTOR']);

  const data = await db.read();

  const savedIds = new Set(
    (data.savedStartups ?? [])
      .filter((s) => s.userId === user.id)
      .map((s) => s.startupId),
  );

  const savedListings = data.startupListings
    .filter((l) => savedIds.has(l.id) && l.status === 'ACTIVE')
    .map(toStartupDto);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('investor.saved.title')}
        subtitle={t('investor.saved.subtitle')}
      />

      {savedListings.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <InlineEmptyState
              title="No saved startups yet"
              description="Browse the marketplace and click the bookmark icon to save listings."
              icon={<Bookmark className="size-5 text-muted-foreground" />}
            />
          </CardContent>
        </Card>
      ) : (
        <StartupMarketplace startups={savedListings} savedIds={savedIds} />
      )}
    </div>
  );
}
