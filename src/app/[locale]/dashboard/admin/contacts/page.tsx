import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MessageSquare } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ContactInbox } from '@/components/features/admin/contact-inbox';
import { Badge } from '@/components/ui/badge';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Contact inbox' };

export default async function AdminContactsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data        = await db.read();
  const submissions = data.contactSubmissions.slice().sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt),
  );

  const total     = submissions.length;
  const unhandled = submissions.filter((s) => !s.handled).length;
  const handled   = total - unhandled;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.contacts.title')}
        subtitle={t('admin.contacts.subtitle')}
        action={
          unhandled > 0 ? (
            <Badge variant="warning" className="gap-1">
              <MessageSquare className="size-3" />
              {unhandled} unhandled
            </Badge>
          ) : (
            <Badge variant="success" className="gap-1">
              <MessageSquare className="size-3" />
              Inbox zero
            </Badge>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('admin.contacts.statTotal')}     value={total}     icon={MessageSquare} />
        <StatCard label={t('admin.contacts.statUnhandled')} value={unhandled}                      />
        <StatCard label={t('admin.contacts.statHandled')}   value={handled}                        />
      </div>

      <ContactInbox initial={submissions} />
    </div>
  );
}
