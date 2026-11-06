import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { listBundlesForAdmin } from '@/server/academy/bundles';
import { listCoursesForAdmin } from '@/server/academy/catalog';
import { resolveText } from '@/lib/localized-text';
import { isLocale, type Locale } from '@/i18n/config';
import { BundlesAdmin } from '@/components/features/academy/admin/bundles-admin';

interface PageProps { params: Promise<{ locale: string }> }

/** Learning paths sold as bundles: admin-priced, mentors paid on full list prices. */
export default async function AdminAcademyBundlesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['ADMIN']);
  const t = await getTranslations('academyAdmin.bundles');
  const [bundles, courses] = await Promise.all([listBundlesForAdmin(), listCoursesForAdmin()]);
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <BundlesAdmin
        initial={bundles}
        courses={courses.filter((c) => c.status === 'PUBLISHED').map((c) => ({ id: c.id, title: resolveText(c.title, locale), priceDzd: c.priceDzd }))}
        locale={(isLocale(locale) ? locale : 'fr') as Locale}
      />
    </div>
  );
}
