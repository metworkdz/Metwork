/**
 * Membership page body — shared by the entrepreneur and freelancer dashboards.
 *
 * Each audience chooses between Free and its one paid plan (Founder or
 * Premium). Everything shown comes from the shared plan views and the member's
 * own membership record, so this page, the pricing page and the purchase API
 * agree on names, prices and what is on sale.
 */
import { getTranslations } from 'next-intl/server';
import { Check, Star, Clock } from 'lucide-react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import { db } from '@/server/db/store';
import {
  getMembershipPlanViews,
  PLAN_COPY_KEYS,
  type PlanAudience,
} from '@/server/memberships/plan-view';
import { getEffectiveMembershipCode, resolveMemberBenefits } from '@/server/memberships/service';
import { planConfigsFrom } from '@/server/memberships/plan-config';
import { normalizePlanCode, PLAN_AUDIENCE } from '@/lib/membership-benefits';
import { memberBadgeFor } from '@/lib/member-badge';
import { MemberBadge } from '@/components/shared/member-badge';
import { MembershipUpgradeButton } from '@/components/features/entrepreneur/membership-upgrade-button';
import { MembershipDowngradeButton } from '@/components/features/entrepreneur/membership-downgrade-button';
import { ScheduledDowngradeBanner } from '@/components/features/entrepreneur/scheduled-downgrade-banner';
import { MembershipPromoSection } from '@/components/features/membership/membership-promo-section';
import type { SessionUser } from '@/types/auth';
import type { Locale } from '@/i18n/config';

interface Props {
  audience: PlanAudience;
  user: SessionUser;
  locale: Locale;
  /** The role's wallet page, for the top-up prompt. */
  walletHref: string;
}

export async function MembershipPageContent({ audience, user, locale, walletHref }: Props) {
  const tm = await getTranslations('membership');
  const [planViews, data] = await Promise.all([getMembershipPlanViews(audience), db.read()]);
  const record = data.users.find((u) => u.id === user.id);

  const effective = getEffectiveMembershipCode(record ?? user);
  const currentPlan = normalizePlanCode(effective);
  const isPaid = currentPlan !== null;
  const membership = (data.userMemberships ?? []).find(
    (m) => m.userId === user.id && m.status === 'ACTIVE' && normalizePlanCode(m.plan) === currentPlan,
  );
  const scheduledChange = user.scheduledMembershipChange ?? null;
  const scheduledDate = user.scheduledChangeDate ?? null;
  const expiresAt = user.membershipExpiresAt ?? null;
  const renews = isPaid && membership?.autoRenew === true && !scheduledChange;
  const badge = memberBadgeFor(user);

  const freeCopy = planViews.find((p) => p.code === 'FREE')!;
  const copyFor = (code: string | null) => {
    if (!code || code === 'FREE') return { name: tm(freeCopy.nameKey), description: tm(freeCopy.descriptionKey) };
    const keys = PLAN_COPY_KEYS[code as keyof typeof PLAN_COPY_KEYS] ?? PLAN_COPY_KEYS.FREE;
    return { name: tm(keys.nameKey), description: tm(keys.descriptionKey) };
  };
  const current = copyFor(currentPlan);

  // A member on a retired plan (Entrepreneur) or on terms better than today's
  // (a Startup member who bought 20 % consultations) keeps them until the
  // period ends; say so instead of letting the plan cards imply otherwise.
  const isRetiredPlan = currentPlan === 'ENTREPRENEUR';
  let grandfathered = false;
  if (record && currentPlan && !isRetiredPlan) {
    const mine = resolveMemberBenefits(data, record);
    const live = planConfigsFrom(data).find((c) => c.planCode === currentPlan);
    grandfathered =
      mine.source !== 'config' &&
      !!live &&
      (mine.consultationDiscountRate !== live.consultationDiscountRate ||
        mine.spaceDiscountRate !== live.spaceDiscountRate);
  }
  // A paid plan made for the other audience (only possible through an admin
  // grant) is shown as current but never offered for purchase here.
  const ownAudiencePlan = currentPlan ? PLAN_AUDIENCE[currentPlan] === audience : true;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: 'long' });

  return (
    <div className="space-y-6">
      {scheduledChange && scheduledDate && (
        <ScheduledDowngradeBanner
          targetName={copyFor(normalizePlanCode(scheduledChange) ?? 'FREE').name}
          scheduledDate={scheduledDate}
          locale={locale}
        />
      )}

      {/* Current plan */}
      <Card className="border-primary-200 bg-primary-50/40">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-primary-700">{tm('currentPlanLabel')}</p>
            <p className="mt-1 flex items-center gap-2 text-xl font-semibold">
              {current.name}
              <MemberBadge badge={badge} />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{current.description}</p>
            {isPaid && expiresAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                {renews
                  ? tm('renewsAutomatically', { date: fmtDate(expiresAt) })
                  : tm('endsOn', { date: fmtDate(expiresAt) })}
              </p>
            )}
            {isRetiredPlan && expiresAt && (
              <p className="mt-2 text-xs text-foreground">{tm('retiredPlanNotice', { date: fmtDate(expiresAt) })}</p>
            )}
            {grandfathered && expiresAt && (
              <p className="mt-2 text-xs text-foreground">{tm('grandfatheredNotice', { date: fmtDate(expiresAt) })}</p>
            )}
            {audience === 'FREELANCER' && currentPlan === 'FREELANCER_PREMIUM' && !badge && (
              <p className="mt-2 text-xs text-muted-foreground">{tm('verifiedBadgePending')}</p>
            )}
          </div>
          {!isPaid && planViews.some((p) => p.onSale) && (
            <Badge variant="primary" className="w-fit">{tm('upgradeAvailable')}</Badge>
          )}
        </CardContent>
      </Card>

      {/* Plans */}
      <div className="grid gap-4 md:grid-cols-2">
        {planViews.map((plan) => {
          const copy = { name: tm(plan.nameKey), description: tm(plan.descriptionKey) };
          const planIsPaid = plan.code !== 'FREE';
          const isCurrent = planIsPaid ? plan.code === currentPlan : !isPaid;
          return (
            <Card
              key={plan.code}
              className={cn('relative flex flex-col', plan.recommended && 'border-primary-300 shadow-md')}
            >
              {plan.recommended && (
                <div className="absolute -top-3 start-6">
                  <Badge variant="primary" className="gap-1">
                    <Star className="size-3" />
                    {tm('recommended')}
                  </Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-lg">{copy.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{copy.description}</p>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex flex-wrap items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {planIsPaid ? formatCurrency(plan.prices.monthly, locale) : tm('priceFree')}
                  </span>
                  {planIsPaid && <span className="text-sm text-muted-foreground">{tm('perMonth')}</span>}
                </div>
                {planIsPaid && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tm('orYearly', {
                      yearly: formatCurrency(plan.prices.annual, locale),
                      percent: plan.prices.annualDiscountPercent,
                    })}
                  </p>
                )}
                <ul className="mt-5 space-y-2 text-sm">
                  {plan.features.map((f) => (
                    <li key={f.key} className="flex items-start gap-2">
                      {f.soon ? (
                        <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary-600" />
                      )}
                      <span className={cn('min-w-0', f.soon ? 'text-muted-foreground' : 'text-foreground')}>
                        {tm(`features.${f.key}`, f.values)}
                        {f.soon && (
                          <span className="ms-2 inline-block rounded bg-muted px-1.5 py-px align-middle text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {tm('soon')}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {isCurrent ? (
                  <button
                    className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium opacity-50"
                    disabled
                  >
                    {tm('currentPlanLabel')}
                  </button>
                ) : !planIsPaid ? (
                  isPaid && (
                    <MembershipDowngradeButton
                      targetPlan="FREE"
                      targetName={copy.name}
                      scheduledDate={expiresAt}
                      locale={locale}
                      alreadyScheduled={scheduledChange === 'FREE'}
                    />
                  )
                ) : plan.onSale && ownAudiencePlan ? (
                  <MembershipUpgradeButton
                    plan={plan.code as Exclude<typeof plan.code, 'FREE'>}
                    priceMonthly={plan.prices.monthly}
                    priceYearly={plan.prices.annual}
                    yearlyDiscountPercent={plan.prices.annualDiscountPercent}
                    planName={copy.name}
                    highlighted={plan.recommended}
                    locale={locale}
                    walletHref={walletHref}
                  />
                ) : (
                  <button
                    className="inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium opacity-50"
                    disabled
                  >
                    {tm('availableSoon')}
                  </button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {(() => {
        const paid = planViews.find((p) => p.code !== 'FREE');
        if (isPaid || !paid || !paid.onSale) return null;
        return (
          <MembershipPromoSection
            nextTierPrice={paid.prices.monthly}
            nextTierName={tm(paid.nameKey)}
            locale={locale}
          />
        );
      })()}
    </div>
  );
}
