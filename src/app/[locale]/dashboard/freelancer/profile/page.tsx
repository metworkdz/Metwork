import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { FreelancerProfileEditor, type EditorProfile } from '@/components/features/freelancer/freelancer-profile-editor';
import { db } from '@/server/db/store';
import { emptyProfile, refreshTrialUnlock } from '@/server/freelancers/service';
import { isFreelancerPremiumOnSale } from '@/config/feature-flags';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerProfilePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.profile');
  const session = await requireRole(['FREELANCER']);
  // Photo and payout account are edited elsewhere — catch the unlock up first.
  await refreshTrialUnlock(session.id);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id)!;
  const stored = data.freelancerProfiles?.find((p) => p.userId === session.id) ?? emptyProfile(session.id, new Date().toISOString());
  // The stored document reference and extraction never reach the browser.
  const initial: EditorProfile = {
    headline: stored.headline,
    bio: stored.bio,
    skills: stored.skills,
    languages: stored.languages,
    remote: stored.remote,
    dayRate: stored.dayRate,
    address: stored.address,
    portfolio: stored.portfolio,
    legal: stored.legal
      ? { status: stored.legal.status, documentKind: stored.legal.documentKind, submittedAt: stored.legal.submittedAt, review: stored.legal.review }
      : null,
    trial: stored.trial,
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <FreelancerProfileEditor
        user={{
          fullName: user.fullName,
          phone: user.phone ?? null,
          city: user.city ?? null,
          avatarUrl: user.avatarUrl ?? null,
          payoutAccount: user.payoutAccount ?? null,
        }}
        initial={initial}
        premiumOnSale={isFreelancerPremiumOnSale()}
      />
    </div>
  );
}
