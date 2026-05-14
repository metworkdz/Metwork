import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { UserProfileHeader } from '@/components/features/membership/user-profile-header';
import { MembershipPassCard, type PassRecentVisit } from '@/components/features/membership/membership-pass-card';
import { resolveTier } from '@/lib/tier-utils';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Metwork Pass' };

export default async function EntrepreneurNetworkPassPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.entrepreneur.networkPass');
  const user = await requireRole(['ENTREPRENEUR']);

  const tier = resolveTier(user);

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

  // ── QR code for the membership pass ──────────────────────────────────────
  // Shows a QR encoding the user's member ID — readable at partner spaces.
  const qrPayload = encodeURIComponent(`METWORK:PASS:${user.id}`);
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${qrPayload}&margin=8&color=09090b`;
  // Human-readable code derived from the user's ID (first 8 hex chars, uppercase)
  const passCode  = `MNP-${user.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Profile header with tier ring */}
      <UserProfileHeader user={user} showMeta avatarSize="lg" />

      {/* Network Pass card */}
      <MembershipPassCard
        user={user}
        creditsRemaining={creditsRemaining}
        creditsMax={creditsMax}
        expiresOn={expiresOn}
        qrCodeDataUrl={qrCodeUrl}
        checkInCode={passCode}
        recentVisits={recentVisits}
      />

      {/* Explorer notice */}
      {tier === 'EXPLORER' && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Upgrade to <strong>Builder</strong> or <strong>Founder</strong> to unlock Metwork Pass
          access at partner coworking spaces.
        </p>
      )}
    </div>
  );
}
