import { setRequestLocale, getLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ConsultationsPanel } from '@/components/features/entrepreneur/consultations-panel';
import { listPublicMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { listActiveMentorCategories } from '@/server/mentor-categories/service';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode, getConsultationDiscountForUser } from '@/server/memberships/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurConsultationsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const lang = (await getLocale()) as Locale;
  const user = await requireRole(['ENTREPRENEUR']);

  const [mentors, categories, data] = await Promise.all([
    listPublicMentors().then((list) => list.map(toMentorDto)),
    listActiveMentorCategories(),
    db.read(),
  ]);

  const effectiveCode = getEffectiveMembershipCode(user);
  // Automatic membership consultation discount, resolved through the
  // snapshot-aware resolver rather than re-derived from the tier.
  const discountPercent = Math.round((await getConsultationDiscountForUser(user.id)) * 100);

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
        categories={categories}
        discountPercent={discountPercent}
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
