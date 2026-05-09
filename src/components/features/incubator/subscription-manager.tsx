'use client';

/**
 * Subscription manager shown on the incubator settings page.
 *
 * Fetches current plan + pricing from GET /api/incubator/subscription,
 * and allows the incubator to:
 *   • Activate the FLAT plan (SEMESTERLY or YEARLY)
 *   • Renew the FLAT plan when expired
 *   • Switch back to the COMMISSION plan
 */
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { CheckCircle2, Loader2, RefreshCcw, Sparkles, TrendingDown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';

// ─── API types ──────────────────────────────────────────────────────────────

interface SubscriptionPricing {
  monthlyPrice: number;
  semesterlyMonths: number;
  semesterlyAmount: number;
  yearlyAmount: number;
  yearlyDiscountPercent: number;
  yearlyMonthlyEquivalent: number;
}

interface SubscriptionInfo {
  subscriptionCode: 'FLAT' | 'COMMISSION';
  billingCycle: 'SEMESTERLY' | 'YEARLY' | null;
  subscriptionStatus: 'ACTIVE' | 'NONE' | 'EXPIRED';
  subscriptionPeriodStart: string | null;
  subscriptionPeriodEnd: string | null;
  subscriptionLastPaidAmount: number | null;
  isActive: boolean;
  pricing: SubscriptionPricing;
  commissionRate: number;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function fetchSubscription(): Promise<SubscriptionInfo> {
  const res = await fetch('/api/incubator/subscription', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load subscription info');
  return res.json() as Promise<SubscriptionInfo>;
}

async function postSubscriptionAction(body: Record<string, unknown>): Promise<SubscriptionInfo> {
  const res = await fetch('/api/incubator/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Action failed');
  }
  return res.json() as Promise<SubscriptionInfo>;
}

// ─── sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status, isActive }: { status: string; isActive: boolean }) {
  if (isActive) return <Badge variant="success">Active</Badge>;
  if (status === 'EXPIRED') return <Badge variant="danger">Expired</Badge>;
  return <Badge variant="outline">None</Badge>;
}

function PricingCard({
  cycle,
  pricing,
  locale,
  selected,
  onSelect,
  disabled,
}: {
  cycle: 'SEMESTERLY' | 'YEARLY';
  pricing: SubscriptionPricing;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
  disabled: boolean;
}) {
  const isSemesterly = cycle === 'SEMESTERLY';
  const amount = isSemesterly ? pricing.semesterlyAmount : pricing.yearlyAmount;
  const months = isSemesterly ? pricing.semesterlyMonths : 12;
  const perMonth = isSemesterly ? pricing.monthlyPrice : pricing.yearlyMonthlyEquivalent;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'relative w-full rounded-lg border p-4 text-start transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border hover:border-primary/40 hover:bg-muted/30',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {!isSemesterly && (
        <span className="absolute end-3 top-3 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          <TrendingDown className="size-3" />
          {pricing.yearlyDiscountPercent}% off
        </span>
      )}
      <div className="flex items-start gap-2">
        {selected ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
        ) : (
          <div className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-muted-foreground/40" />
        )}
        <div>
          <div className="font-semibold leading-none">
            {isSemesterly ? `${months}-month` : '12-month'} plan
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {formatCurrency(amount, locale)}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            ≈ {formatCurrency(perMonth, locale)}/month · billed once
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function SubscriptionManager() {
  const locale = useLocale() as Locale;
  const [info, setInfo] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<'SEMESTERLY' | 'YEARLY'>('SEMESTERLY');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchSubscription()
      .then((data) => {
        setInfo(data);
        // Pre-select the current cycle if on FLAT
        if (data.billingCycle) setSelectedCycle(data.billingCycle);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
      .finally(() => setLoading(false));
  }, []);

  async function handleActivateFlat() {
    if (!info) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const updated = await postSubscriptionAction({
        action: 'ACTIVATE_FLAT',
        billingCycle: selectedCycle,
      });
      setInfo(updated);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSwitchToCommission() {
    if (!info) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const updated = await postSubscriptionAction({ action: 'SWITCH_TO_COMMISSION' });
      setInfo(updated);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── loading / error ──
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading subscription…
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {error ?? 'Could not load subscription info. Make sure your incubator profile is set up.'}
      </div>
    );
  }

  const isFlat = info.subscriptionCode === 'FLAT';
  const isCommission = info.subscriptionCode === 'COMMISSION';
  const isExpired = info.subscriptionStatus === 'EXPIRED';
  const needsActivation = !info.isActive; // NONE or EXPIRED

  return (
    <div className="space-y-6">
      {/* ── Current status card ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base">Current plan</CardTitle>
              <CardDescription className="mt-0.5">
                {isFlat
                  ? `FLAT — fixed monthly subscription`
                  : `COMMISSION — platform fee on each booking`}
              </CardDescription>
            </div>
            <StatusBadge status={info.subscriptionStatus} isActive={info.isActive} />
          </div>
        </CardHeader>

        <CardContent className="space-y-3 pb-3">
          {isFlat && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Billing cycle</span>
                  <div className="font-medium capitalize">
                    {info.billingCycle === 'SEMESTERLY'
                      ? `${info.pricing.semesterlyMonths}-month`
                      : '12-month (yearly)'}
                  </div>
                </div>
                {info.subscriptionLastPaidAmount != null && (
                  <div>
                    <span className="text-muted-foreground">Last payment</span>
                    <div className="font-medium tabular-nums">
                      {formatCurrency(info.subscriptionLastPaidAmount, locale)}
                    </div>
                  </div>
                )}
                {info.subscriptionPeriodStart && (
                  <div>
                    <span className="text-muted-foreground">Started</span>
                    <div className="font-medium">
                      {formatDate(info.subscriptionPeriodStart, locale, { dateStyle: 'medium' })}
                    </div>
                  </div>
                )}
                {info.subscriptionPeriodEnd && (
                  <div>
                    <span className="text-muted-foreground">
                      {isExpired ? 'Expired' : 'Renews'}
                    </span>
                    <div className={cn('font-medium', isExpired && 'text-destructive')}>
                      {formatDate(info.subscriptionPeriodEnd, locale, { dateStyle: 'medium' })}
                    </div>
                  </div>
                )}
              </div>

              {isExpired && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Your subscription has expired. Renew below to restore access.
                </div>
              )}
            </>
          )}

          {isCommission && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Platform commission rate</span>
                <span className="font-semibold tabular-nums">
                  {(info.commissionRate * 100).toFixed(0)}%
                </span>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                A commission is deducted from each booking payment processed through the platform.
                No fixed monthly fee.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="border-t border-border" />

      {/* ── Plan switcher ── */}
      {isCommission || needsActivation ? (
        /* Show FLAT upgrade / activation options */
        <div className="space-y-4">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              {needsActivation && isFlat ? 'Renew FLAT plan' : 'Activate FLAT plan'}
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Pay a fixed monthly fee and keep 100% of booking revenue — no commission deducted.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <PricingCard
              cycle="SEMESTERLY"
              pricing={info.pricing}
              locale={locale}
              selected={selectedCycle === 'SEMESTERLY'}
              onSelect={() => setSelectedCycle('SEMESTERLY')}
              disabled={submitting}
            />
            <PricingCard
              cycle="YEARLY"
              pricing={info.pricing}
              locale={locale}
              selected={selectedCycle === 'YEARLY'}
              onSelect={() => setSelectedCycle('YEARLY')}
              disabled={submitting}
            />
          </div>

          {actionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          )}

          <Button
            onClick={() => void handleActivateFlat()}
            disabled={submitting}
            loading={submitting}
            className="w-full sm:w-auto"
          >
            {submitting
              ? 'Processing…'
              : `Activate ${selectedCycle === 'YEARLY' ? '12-month' : `${info.pricing.semesterlyMonths}-month`} FLAT plan`}
          </Button>
        </div>
      ) : (
        /* Currently on active FLAT — offer switch to commission */
        <div className="space-y-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Zap className="size-4 text-muted-foreground" />
              Switch to COMMISSION plan
            </h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              No monthly fee — instead the platform deducts{' '}
              <strong>{(info.commissionRate * 100).toFixed(0)}%</strong> from each booking. Best
              when booking volume is low.
            </p>
          </div>

          {actionError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {actionError}
            </div>
          )}

          <Button
            variant="outline"
            onClick={() => void handleSwitchToCommission()}
            disabled={submitting}
            loading={submitting}
            className="gap-1.5"
          >
            <RefreshCcw className="size-3.5" />
            {submitting ? 'Switching…' : 'Switch to COMMISSION'}
          </Button>
        </div>
      )}

      {/* ── Renewal option while on active FLAT ── */}
      {isFlat && info.isActive && (
        <>
          <div className="border-t border-border" />
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Renew / change billing cycle</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Select a cycle below to renew or switch your billing period. The new period starts
                immediately.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PricingCard
                cycle="SEMESTERLY"
                pricing={info.pricing}
                locale={locale}
                selected={selectedCycle === 'SEMESTERLY'}
                onSelect={() => setSelectedCycle('SEMESTERLY')}
                disabled={submitting}
              />
              <PricingCard
                cycle="YEARLY"
                pricing={info.pricing}
                locale={locale}
                selected={selectedCycle === 'YEARLY'}
                onSelect={() => setSelectedCycle('YEARLY')}
                disabled={submitting}
              />
            </div>
            {actionError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {actionError}
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => void handleActivateFlat()}
              disabled={submitting}
              loading={submitting}
              className="gap-1.5"
            >
              <RefreshCcw className="size-3.5" />
              {submitting ? 'Renewing…' : 'Renew plan'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
