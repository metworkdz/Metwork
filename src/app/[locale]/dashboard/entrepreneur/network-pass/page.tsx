import { setRequestLocale, getTranslations } from 'next-intl/server';
import { Clock, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { UserProfileHeader } from '@/components/features/membership/user-profile-header';
import { type PassRecentVisit } from '@/components/features/membership/membership-pass-card';
import { MembershipPassCardLive } from '@/components/features/membership/membership-pass-card-live';
import { db } from '@/server/db/store';
import { getEffectiveMembershipCode } from '@/server/memberships/service';
import { getMembershipPlanViews } from '@/server/memberships/plan-view';
import { normalizePlanCode } from '@/lib/membership-benefits';
import { isNetworkPassEnabled } from '@/config/feature-flags';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Metwork Pass' };

export default async function EntrepreneurNetworkPassPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.entrepreneur.networkPass');
  const tm = await getTranslations('membership');
  const user = await requireRole(['ENTREPRENEUR']);

  // ── Feature off: placeholder, not a dead link ──────────────────────────────
  //
  // The nav entry stays, so this route has to lead somewhere useful. It shows
  // the member what they DO have (their plan) and a route to change it, rather
  // than an empty page apologising for a missing feature.
  //
  // Plan name comes from the shared plan-view model, the same source the public
  // pricing page and the dashboard membership cards read — never a local label
  // map, which is exactly how this page drifted out of translation before.
  if (!isNetworkPassEnabled()) {
    const planViews = await getMembershipPlanViews();
    const planCode = normalizePlanCode(getEffectiveMembershipCode(user)) ?? 'FREE';
    const plan = planViews.find((p) => p.code === planCode);

    return (
      <div className="space-y-6">
        {/* No subtitle here: it describes checking in at partner spaces, which
            would contradict the "coming soon" card directly below it. */}
        <DashboardPageHeader title={t('title')} />

        <UserProfileHeader user={user} showMeta avatarSize="lg" />

        {/* Current plan + upgrade route */}
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('currentPlanLabel')}
              </p>
              <p className="mt-1 truncate text-xl font-semibold text-foreground">
                {plan ? tm(plan.nameKey) : getEffectiveMembershipCode(user)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{t('upgradeHint')}</p>
            </div>

            {/* Gold accent — a new accent for the upgrade route only. Brand
                green stays the primary action colour everywhere else. */}
            <Link
              href="/dashboard/entrepreneur/membership"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-gold-600 px-6 text-sm font-bold uppercase tracking-wider text-[#0D0D0D] shadow-sm transition-colors hover:bg-gold-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-600 focus-visible:ring-offset-2"
            >
              <Sparkles className="size-4" />
              {t('upgradeCta')}
            </Link>
          </div>
        </div>

        {/* Coming soon */}
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Clock className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">{t('comingSoonTitle')}</h2>
          <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
            {t('comingSoonBody')}
          </p>
        </div>
      </div>
    );
  }

  // ── Feature on: the real pass ──────────────────────────────────────────────
  const data = await db.read();

  // ── Credits ────────────────────────────────────────────────────────────────
  const creditsRemaining = user.networkCredits  ?? 0;
  const creditsMax       = user.networkCreditsMax ?? 0;

  // ── Pass validity ─────────────────────────────────────────────────────────
  // Treat membership expiry as pass expiry; fall back to end-of-year
  const expiresOn = user.membershipExpiresAt
    ?? `${new Date().getFullYear()}-12-31`;

  // ── Recent visits (current calendar month, latest 5) ──────────────────────
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const recentVisits: PassRecentVisit[] = (data.networkVisits ?? [])
    .filter(
      (v) =>
        v.userId === user.id &&
        v.checkedInAt &&
        v.checkedInAt >= monthStart,
    )
    .sort((a, b) => (b.checkedInAt ?? '').localeCompare(a.checkedInAt ?? ''))
    .slice(0, 5)
    .map((v) => {
      const space = (data.spaces ?? []).find((s) => s.id === v.spaceId);
      return {
        spaceName: space?.name ?? 'Unknown space',
        date:      v.checkedInAt ?? v.createdAt,
        spaceId:   v.spaceId,
      };
    });


  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Profile header with tier ring */}
      <UserProfileHeader user={user} showMeta avatarSize="lg" />

      {/* Network Pass card (live — fetches current check-in QR client-side).
          Gated on the ACTUAL allowance rather than on the tier: a paid plan can
          grant zero passes, and rendering a 0 / 0 pass card would be worse than
          saying plainly that the plan does not include them. */}
      {creditsMax <= 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center">
          <h2 className="text-lg font-semibold">{t('noPassTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('noPassBody')}</p>
        </div>
      ) : (
        <MembershipPassCardLive
          user={user}
          creditsRemaining={creditsRemaining}
          creditsMax={creditsMax}
          expiresOn={expiresOn}
          recentVisits={recentVisits}
        />
      )}

    </div>
  );
}
