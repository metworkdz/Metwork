import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Inbox } from '@/components/features/messaging/inbox';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ c?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('inbox');
  return { title: t('pageTitle') };
}

export default async function EntrepreneurMessagesPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('inbox');
  await requireRole(['ENTREPRENEUR']);
  const { c } = await searchParams;
  return (
    <div className="space-y-4">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <Inbox basePath="/dashboard/entrepreneur/messages" initialThreadId={typeof c === 'string' && /^[0-9a-f-]{36}$/.test(c) ? c : null} canAttach={false} />
    </div>
  );
}
