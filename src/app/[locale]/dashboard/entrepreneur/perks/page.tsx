import { setRequestLocale, getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Gift, Zap, HeadphonesIcon, Tag, BookOpen } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { getEffectiveMembershipCode } from '@/server/memberships/service';

interface PageProps {
  params: Promise<{ locale: string }>;
}

interface Perk {
  icon: React.ElementType;
  title: string;
  description: string;
  tag?: string;
}

const perks: Perk[] = [
  {
    icon: HeadphonesIcon,
    title: 'Priority Support',
    description:
      'Skip the queue — your support tickets are handled within 4 business hours by a dedicated team member.',
    tag: 'ENTREPRENEUR+',
  },
  {
    icon: Tag,
    title: 'Event Discounts',
    description:
      'Get 15% off all Metwork-hosted workshops, networking events, and bootcamps — automatically applied at checkout.',
    tag: 'ENTREPRENEUR+',
  },
  {
    icon: BookOpen,
    title: 'Resource Library',
    description:
      'Unlock the full library of startup playbooks, investor pitch templates, and financial model spreadsheets curated by Metwork.',
    tag: 'ENTREPRENEUR+',
  },
  {
    icon: Zap,
    title: 'Mentor Sessions',
    description:
      'Enjoy 1 free 30-minute mentor consultation per month — no wallet charge, no strings attached.',
    tag: 'ENTREPRENEUR+',
  },
  {
    icon: Gift,
    title: 'Partner Deals',
    description:
      'Exclusive discounts from Metwork partners: cloud credits, legal services, accounting tools, and co-working passes.',
    tag: 'ENTREPRENEUR+',
  },
];

const startupPerks: Perk[] = [
  {
    icon: Tag,
    title: '20% Space Booking Discount',
    description:
      'Automatically applied to every coworking space or private office reservation — no promo code needed.',
    tag: 'STARTUP',
  },
  {
    icon: Zap,
    title: '3 Mentor Sessions / Month',
    description:
      'Three free mentor consultations per calendar month — ideal for fast-moving product and fundraising sprints.',
    tag: 'STARTUP',
  },
  {
    icon: BookOpen,
    title: 'Featured Marketplace Listing',
    description:
      'Your startup appears at the top of the investor marketplace, increasing visibility with active investors.',
    tag: 'STARTUP',
  },
];

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

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('entrepreneur.perks.title')}
        subtitle={t('entrepreneur.perks.subtitle')}
      />

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
