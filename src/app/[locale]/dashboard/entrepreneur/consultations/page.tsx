import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPanel } from '@/components/features/entrepreneur/consultations-panel';
import { listMentors } from '@/server/mentors/service';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode, CONSULTATION_QUOTA } from '@/server/memberships/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function currentQuotaMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
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

  const [mentors, data] = await Promise.all([
    listMentors(),
    db.read(),
  ]);

  const effectiveCode = getEffectiveMembershipCode(user);
  const freeQuota     = CONSULTATION_QUOTA[effectiveCode] ?? 0;

  // Booking requests go through the /book route → saved in mentorBookings (PENDING → APPROVED/REJECTED).
  // Old auto-confirmed records from /consult are in mentorConsultations — not shown here any more.
  const bookings = (data.mentorBookings ?? [])
    .filter((b) => b.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Free quota usage for the current calendar month — mirrors GET /api/consultations.
  // Quick consultations (auto-charged against the free quota) live in mentorConsultations.
  const quotaMonth = currentQuotaMonth();
  const freeSessionsUsed = (data.mentorConsultations ?? []).filter(
    (c) =>
      c.userId === user.id &&
      c.quotaMonth === quotaMonth &&
      c.chargeType === 'FREE_QUOTA' &&
      c.status !== 'CANCELLED',
  ).length;
  const freeSessionsRemaining = Math.max(0, freeQuota - freeSessionsUsed);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.consultations.title')}
        subtitle={t('entrepreneur.consultations.subtitle')}
      />
      <ConsultationsPanel
        initial={bookings}
        mentors={mentors}
        freeQuota={freeQuota}
        freeSessionsUsed={freeSessionsUsed}
        freeSessionsRemaining={freeSessionsRemaining}
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
