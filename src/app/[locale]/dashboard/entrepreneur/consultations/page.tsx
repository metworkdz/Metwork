import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPanel } from '@/components/features/entrepreneur/consultations-panel';
import { listMentors } from '@/server/mentors/service';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode, CONSULTATION_QUOTA } from '@/server/memberships/service';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export default async function EntrepreneurConsultationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);

  const [mentors, data] = await Promise.all([
    listMentors(),
    db.read(),
  ]);

  const effectiveCode = getEffectiveMembershipCode(user);
  const freeQuota     = CONSULTATION_QUOTA[effectiveCode] ?? 0;
  const quotaMonth    = currentQuotaMonth();

  const consultations = (data.mentorConsultations ?? [])
    .filter((c) => c.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const freeUsed = consultations.filter(
    (c) =>
      c.quotaMonth === quotaMonth &&
      c.chargeType === 'FREE_QUOTA' &&
      c.status !== 'CANCELLED',
  ).length;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.consultations.title')}
        subtitle={t('entrepreneur.consultations.subtitle')}
      />
      <ConsultationsPanel
        initial={consultations}
        mentors={mentors}
        freeQuota={freeQuota}
        freeUsed={freeUsed}
        membershipCode={effectiveCode === 'FREE' ? null : effectiveCode}
        locale={lang}
      />
    </div>
  );
}
