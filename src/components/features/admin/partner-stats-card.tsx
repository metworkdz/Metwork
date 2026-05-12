'use client';

/**
 * AdminPartnerStatsCard
 *
 * A compact summary card for a single partner space, shown in the admin
 * partner management list. Displays key network metrics with a gold accent
 * header (all partner spaces are Builder-tier accessible, so gold is the
 * appropriate premium accent).
 *
 * Pass `onManage` to wire the "Manage Settings" button.
 */

import { Building2, TrendingUp, Users, Tag, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PartnerStatsCardData {
  partnerId: string;
  spaceId: string;
  spaceName: string;
  incubatorName?: string;
  isActive: boolean;
  /** Visits in the current calendar month. */
  visitsThisMonth: number;
  /** Total network revenue earned (DZD). */
  totalPayoutEarned: number;
  /** Average occupancy percentage (0–100) — pass null if unknown. */
  occupancyAvgPct?: number | null;
  /** Most common check-in hour range (e.g. "9–11 am"). */
  peakHours?: string | null;
  promoCodesRedeemed: number;
  uniqueReferrals: number;
}

interface Props {
  data: PartnerStatsCardData;
  onManage?: () => void;
  className?: string;
}

// ─── Metric row ───────────────────────────────────────────────────────────────

function MetricRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="text-gold-600 dark:text-gold-400">{icon}</span>
        {label}
      </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AdminPartnerStatsCard({ data, onManage, className }: Props) {
  const {
    spaceName,
    incubatorName,
    isActive,
    visitsThisMonth,
    totalPayoutEarned,
    occupancyAvgPct,
    peakHours,
    promoCodesRedeemed,
    uniqueReferrals,
  } = data;

  const fmtDzd = (n: number) => `${n.toLocaleString()} DZD`;

  return (
    <Card
      className={cn(
        'overflow-hidden border-gold-600/40',
        !isActive && 'opacity-60',
        className,
      )}
    >
      {/* Gold accent top stripe */}
      <div className="h-1 w-full bg-gradient-to-r from-gold-600 to-gold-400" aria-hidden />

      <CardContent className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 rounded-lg bg-gold-50 p-2 dark:bg-gold-900/20">
              <Building2 className="h-4 w-4 text-gold-700 dark:text-gold-400" />
            </div>
            <div>
              <p className="font-semibold leading-tight">{spaceName}</p>
              {incubatorName && (
                <p className="mt-0.5 text-xs text-muted-foreground">{incubatorName}</p>
              )}
            </div>
          </div>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              isActive
                ? 'bg-gold-50 text-gold-700 dark:bg-gold-900/20 dark:text-gold-400'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-border" />

        {/* Metrics */}
        <div className="divide-y divide-border/60">
          <MetricRow
            icon={<Users className="h-3.5 w-3.5" />}
            label="Network visits"
            value={`${visitsThisMonth} this month`}
          />
          <MetricRow
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            label="Network revenue"
            value={fmtDzd(totalPayoutEarned)}
          />
          {occupancyAvgPct != null && (
            <MetricRow
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Occupancy trend"
              value={`${occupancyAvgPct}% avg`}
            />
          )}
          {peakHours && (
            <MetricRow
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Peak hours"
              value={peakHours}
            />
          )}
          <MetricRow
            icon={<Tag className="h-3.5 w-3.5" />}
            label="Promo codes redeemed"
            value={promoCodesRedeemed}
          />
          <MetricRow
            icon={<Users className="h-3.5 w-3.5" />}
            label="Unique referrals"
            value={uniqueReferrals}
          />
        </div>

        {/* Divider */}
        <div className="my-4 border-t border-border" />

        {/* Action */}
        {onManage && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-gold-600/50 text-gold-700 hover:bg-gold-50 dark:border-gold-600/40 dark:text-gold-400 dark:hover:bg-gold-900/20"
            onClick={onManage}
          >
            <Settings2 className="h-4 w-4" />
            Manage settings
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
