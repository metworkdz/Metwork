import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { CofounderTab } from '@/components/features/cofounder/cofounder-tab';
import { db } from '@/server/db/store';
import { profileOf } from '@/server/cofounder/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cofounder');
  return { title: t('pageTitle') };
}

export default async function EntrepreneurCofounderPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cofounder');
  const session = await requireRole(['ENTREPRENEUR']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id) ?? null;
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <CofounderTab
        initialProfile={profileOf(data, user ?? session)}
        basePath="/dashboard/entrepreneur/cofounder"
        membershipPath="/dashboard/entrepreneur/membership"
        phoneVerified={Boolean(user?.phoneVerified)}
      />
    </div>
  );
}
