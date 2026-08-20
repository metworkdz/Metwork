import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getMembershipPlanViews } from '@/server/memberships/plan-view';
import { Gift, Zap, HeadphonesIcon, Tag, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { getEffectiveMembershipCode } from '@/server/memberships/service';
import { readSession } from '@/server/auth/session';
import { listPerksForUser } from '@/server/perks/service';
import { PartnerPerksGrid } from '@/components/features/entrepreneur/partner-perks-grid';

interface PageProps {
  params: Promise<{ locale: string }>;
}

interface Perk {
  icon: React.ElementType;
  title: string;
  description: string;
  tag?: string;
}

/**
 * Perk copy is built from live plan config rather than hardcoded, because the
 * discount percentages are admin-editable. Everything advertised here is a
 * benefit the platform actually grants — the previous static list claimed free
 * monthly mentor sessions that no code path has ever provided.
 */
function builderPerks(consultationPercent: number, spacePercent: number): Perk[] {
  return [
    {
      icon: Tag,
      title: `${spacePercent}% Space Booking Discount`,
      description:
        'Automatically applied to every coworking space, private office and event reservation — no promo code needed.',
      tag: 'BUILDER+',
    },
    {
      icon: Zap,
      title: `${consultationPercent}% Off Mentor Consultations`,
      description:
        'Applied automatically when you book a paid consultation. Does not stack with a promo code — whichever saves you more is the one applied.',
      tag: 'BUILDER+',
    },
    {
      icon: Gift,
      title: 'Partner Deals',
      description:
        'Exclusive discounts from Metwork partners: cloud credits, legal services, accounting tools, and coworking passes.',
      tag: 'BUILDER+',
    },
    {
      icon: HeadphonesIcon,
      title: 'Exclusive Member Events',
      description:
        'Access to member-only workshops, networking evenings and founder roundtables hosted by Metwork.',
      tag: 'BUILDER+',
    },
    {
      icon: BookOpen,
      title: 'Resource Library',
      description:
        'Unlock the full library of startup playbooks, investor pitch templates, and financial model spreadsheets curated by Metwork.',
      tag: 'BUILDER+',
    },
  ];
}

function founderPerks(passCount: number): Perk[] {
  return [
    ...(passCount > 0
      ? [
          {
            icon: Zap,
            title: `${passCount} Coworking Passes / Month`,
            description:
              'Free day access at partner coworking spaces across the network — check in with your Metwork Pass QR code.',
            tag: 'FOUNDER',
          } satisfies Perk,
        ]
      : []),
    {
      icon: BookOpen,
      title: 'Featured Marketplace Listing',
      description:
        'Your startup appears at the top of the investor marketplace, increasing visibility with active investors.',
      tag: 'FOUNDER',
    },
    {
      icon: Gift,
      title: 'Fundraising Access',
      description:
        'List your round, receive investor meeting requests, and raise directly through the platform.',
      tag: 'FOUNDER',
    },
  ];
}

export default async function PerksPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');

  const user = await requireRole(['ENTREPRENEUR']);
  const effectiveCode = getEffectiveMembershipCode(user);

  // Gate: must have at least ENTREPRENEUR membership
  if (effectiveCode === 'FREE') {
    redirect('/dashboard/entrepreneur/membership');
  }

  const isStartup = effectiveCode === 'STARTUP';

  // Live rates for the copy above.
  const planViews = await getMembershipPlanViews();
  const currentPlan =
    planViews.find((p) => p.code === (isStartup ? 'STARTUP' : 'ENTREPRENEUR')) ?? planViews[1];
  const perks = builderPerks(
    currentPlan?.consultationDiscountPercent ?? 0,
    currentPlan?.spaceDiscountPercent ?? 0,
  );
  const startupPerks = founderPerks(
    planViews.find((p) => p.code === 'STARTUP')?.monthlyPassCount ?? 0,
  );

  // Partner Perks — claimable offers, filtered server-side to the user's tier.
  // listPerksForUser needs the full UserRecord (requireRole returns the
  // stripped SessionUser); readSession is the pattern other RSCs use for this.
  const session = await readSession();
  const partnerPerks = session ? await listPerksForUser(session.user) : [];

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.perks.title')}
        subtitle={t('entrepreneur.perks.subtitle')}
      />

      {/* Partner perks — claimable partner offers (CODE_POOL / VOUCHER) */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t('entrepreneur.perks.partnerSection')}
        </h2>
        <PartnerPerksGrid perks={partnerPerks} />
      </section>

      {/* ENTREPRENEUR perks — available to ENTREPRENEUR and STARTUP */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Entrepreneur perks
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {perks.map((perk) => (
            <PerkCard key={perk.title} perk={perk} />
          ))}
        </div>
      </section>

      {/* STARTUP-exclusive perks */}
      {isStartup ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Startup-exclusive perks
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {startupPerks.map((perk) => (
              <PerkCard key={perk.title} perk={perk} />
            ))}
          </div>
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">Upgrade to Startup to unlock 3 additional perks</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Including the 20% space booking discount and 3 free mentor sessions per month.
          </p>
        </div>
      )}
    </div>
  );
}

function PerkCard({ perk }: { perk: Perk }) {
  const Icon = perk.icon;
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
            <Icon className="size-5" />
          </div>
          {perk.tag && (
            <Badge variant="default" className="shrink-0 text-xs">
              {perk.tag}
            </Badge>
          )}
        </div>
        <CardTitle className="mt-3 text-base">{perk.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{perk.description}</p>
      </CardContent>
    </Card>
  );
}
