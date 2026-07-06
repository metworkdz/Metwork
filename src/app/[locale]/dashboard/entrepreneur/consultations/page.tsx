import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPanel } from '@/components/features/entrepreneur/consultations-panel';
import { listPublicMentors } from '@/server/mentors/service';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode, getUserConsultationQuota } from '@/server/memberships/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function nextMonthResetISO(): string {
  const d = new Date();
  // First day of next month, UTC.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export default async function EntrepreneurConsultationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);

  const [mentors, data, quota] = await Promise.all([
    listPublicMentors(),
    db.read(),
    // Single source of truth for the monthly free-session quota — the same
    // resolver the instant-book write path and GET /api/consultations use.
    getUserConsultationQuota(user.id),
  ]);

  const effectiveCode = getEffectiveMembershipCode(user);

  // Booking requests go through the /book route → saved in mentorBookings (PENDING → APPROVED/REJECTED).
  // Old auto-confirmed records from /consult are in mentorConsultations — not shown here any more.
  const bookings = (data.mentorBookings ?? [])
    .filter((b) => b.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.consultations.title')}
        subtitle={t('entrepreneur.consultations.subtitle')}
      />
      <ConsultationsPanel
        initial={bookings}
        mentors={mentors}
        freeQuota={quota.quota}
        freeSessionsUsed={quota.used}
        freeSessionsRemaining={quota.remaining}
        quotaResetISO={nextMonthResetISO()}
        membershipCode={effectiveCode === 'FREE' ? null : effectiveCode}
        locale={lang}
        userName={user.fullName}
        userEmail={user.email}
        userPhone={user.phone ?? ''}
        instantBookEnabled={isInstantBookEnabled()}
      />
    </div>
  );
}
