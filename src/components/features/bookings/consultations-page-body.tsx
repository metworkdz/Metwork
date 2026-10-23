/**
 * Consultations page body — shared by the entrepreneur and freelancer
 * dashboards so both see the same booking panel, prices and discount rules.
 */
import { ConsultationsPanel } from '@/components/features/entrepreneur/consultations-panel';
import { listPublicMentors } from '@/server/mentors/service';
import { toMentorDto } from '@/server/mentors/serialize';
import { listActiveMentorCategories } from '@/server/mentor-categories/service';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode, getConsultationDiscountForUser } from '@/server/memberships/service';
import { isInstantBookEnabled } from '@/server/consultations/instant-book';
import type { SessionUser } from '@/types/auth';
import type { Locale } from '@/i18n/config';

export async function ConsultationsPageBody({ user, locale }: { user: SessionUser; locale: Locale }) {
  const [mentors, categories, data] = await Promise.all([
    listPublicMentors().then((list) => list.map(toMentorDto)),
    listActiveMentorCategories(),
    db.read(),
  ]);

  const effectiveCode = getEffectiveMembershipCode(user);
  // Automatic membership consultation discount, resolved through the
  // snapshot-aware resolver rather than re-derived from the tier.
  const discountPercent = Math.round((await getConsultationDiscountForUser(user.id)) * 100);

  const bookings = (data.mentorBookings ?? [])
    .filter((b) => b.userId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <ConsultationsPanel
      initial={bookings}
      mentors={mentors}
      categories={categories}
      discountPercent={discountPercent}
      membershipCode={effectiveCode === 'FREE' ? null : effectiveCode}
      locale={locale}
      userName={user.fullName}
      userEmail={user.email}
      userPhone={user.phone ?? ''}
      instantBookEnabled={isInstantBookEnabled()}
    />
  );
}
