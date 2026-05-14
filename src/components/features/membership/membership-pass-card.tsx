'use client';

/**
 * MembershipPassCard
 *
 * Displays a user's Network Pass in a premium card that matches their tier.
 * The card shows:
 *   - Tier badge + member-since date
 *   - Credit progress bar (gold/platinum gradient)
 *   - QR code with tier-tinted background (when available)
 *   - Recent visits list
 *   - Download PDF + Refresh QR action buttons
 *
 * Responsive: stacks vertically on mobile, two columns on sm+.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, RefreshCw, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { cn } from '@/lib/utils';
import { resolveTier, TIER_CSS_VAR, type MembershipTier } from '@/lib/tier-utils';
import type { SessionUser } from '@/types/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PassRecentVisit {
  spaceName: string;
  /** ISO date or datetime string. */
  date: string;
  spaceId?: string;
}

interface Props {
  user: SessionUser;
  creditsRemaining: number;
  creditsMax: number;
  /** ISO date string (YYYY-MM-DD) or datetime. */
  expiresOn: string;
  /** base64 QR data URL ("data:image/png;base64,…"). Omit when not yet generated. */
  qrCodeDataUrl?: string | null;
  /** Human-readable pass code shown below the QR, e.g. "MNP-2026-00145". */
  checkInCode?: string | null;
  recentVisits?: PassRecentVisit[];
  onRefreshQr?: () => Promise<void>;
  onDownloadPdf?: () => void;
  className?: string;
}

// ─── Tier style helpers ───────────────────────────────────────────────────────

const CARD_BORDER: Record<MembershipTier, string> = {
  EXPLORER: 'border-zinc-200 dark:border-zinc-700',
  BUILDER:  'border-gold-600/70',
  FOUNDER:  'border-platinum-300/80 dark:border-platinum-600/60',
};

const PROGRESS_STYLE: Record<MembershipTier, string> = {
  EXPLORER: 'bg-zinc-400',
  BUILDER:  'bg-gradient-to-r from-gold-600 to-gold-400',
  FOUNDER:  'bg-gradient-to-r from-platinum-600 to-platinum-300',
};

const QR_BG: Record<MembershipTier, string> = {
  EXPLORER: 'bg-zinc-50 dark:bg-zinc-800',
  BUILDER:  'bg-gold-50 dark:bg-gold-900/20',
  FOUNDER:  'bg-platinum-50 dark:bg-platinum-900/20',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function MembershipPassCard({
  user,
  creditsRemaining,
  creditsMax,
  expiresOn,
  qrCodeDataUrl,
  checkInCode,
  recentVisits = [],
  onRefreshQr,
  onDownloadPdf,
  className,
}: Props) {
  const t = useTranslations('membership.passCard');
  const tier = resolveTier(user);
  const [refreshing, setRefreshing] = useState(false);

  const progressPct = creditsMax > 0
    ? Math.min(100, Math.round((creditsRemaining / creditsMax) * 100))
    : 0;

  const memberSince = user.membershipStartDate
    ? new Date(user.membershipStartDate).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  const expiresFormatted = new Date(expiresOn).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const resetDate = user.networkCreditsResetDate
    ? new Date(user.networkCreditsResetDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;

  async function handleRefresh() {
    if (!onRefreshQr || refreshing) return;
    setRefreshing(true);
    try { await onRefreshQr(); } finally { setRefreshing(false); }
  }

  const accentVar = TIER_CSS_VAR[tier];

  return (
    <div
      className={cn(
        'rounded-2xl border-2 bg-card text-card-foreground shadow-sm',
        CARD_BORDER[tier],
        tier === 'FOUNDER' && 'founder-shimmer',
        className,
      )}
      style={tier !== 'EXPLORER'
        ? { boxShadow: `0 2px 20px var(--color-${tier === 'BUILDER' ? 'gold' : 'platinum'}-glow)` }
        : undefined}
    >
      {/* ── Thin accent stripe at top ── */}
      {tier !== 'EXPLORER' && (
        <div
          className="h-1 w-full rounded-t-2xl"
          style={{ background: accentVar }}
          aria-hidden
        />
      )}

      <div className="p-6">
        {/* ── Header row ── */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <MembershipTierBadge tier={tier} size="lg" />
            {memberSince && (
              <p className="mt-1.5 text-xs text-muted-foreground">{t('memberSince', { date: memberSince })}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('networkPass')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('validUntil', { date: expiresFormatted })}
            </p>
          </div>
        </div>

        {/* ── Credits bar ── */}
        {creditsMax > 0 && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="font-medium">
                {t('credits', { remaining: creditsRemaining, max: creditsMax })}
              </span>
              {resetDate && (
                <span className="text-muted-foreground">{t('resetsOn', { date: resetDate })}</span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', PROGRESS_STYLE[tier])}
                style={{ width: `${progressPct}%` }}
                role="progressbar"
                aria-valuenow={creditsRemaining}
                aria-valuemin={0}
                aria-valuemax={creditsMax}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('sessionsRemaining', { count: creditsRemaining })}
            </p>
          </div>
        )}

        {/* ── Two-column grid on sm+ ── */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2">

          {/* Left: QR code */}
          <div className="flex flex-col items-center gap-3">
            <div
              className={cn(
                'flex h-[148px] w-[148px] items-center justify-center rounded-xl border p-2',
                QR_BG[tier],
                tier === 'BUILDER'  && 'border-gold-200 dark:border-gold-800/40',
                tier === 'FOUNDER'  && 'border-platinum-200 dark:border-platinum-700/40',
                tier === 'EXPLORER' && 'border-zinc-200 dark:border-zinc-700',
              )}
            >
              {qrCodeDataUrl ? (
                <img
                  src={qrCodeDataUrl}
                  alt={t('qrAlt')}
                  className="h-full w-full rounded-lg object-contain"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-center text-xs text-muted-foreground">
                  {t('qrNotAvailable')}
                </div>
              )}
            </div>

            {checkInCode && (
              <p className="font-mono text-sm font-semibold tracking-widest">
                {checkInCode}
              </p>
            )}

            <div className="flex gap-2">
              {onRefreshQr && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRefresh()}
                  disabled={refreshing}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
                  {refreshing ? t('refreshing') : t('refreshQr')}
                </Button>
              )}
              {onDownloadPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onDownloadPdf}
                  className="gap-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('downloadPdf')}
                </Button>
              )}
            </div>
          </div>

          {/* Right: recent visits */}
          <div>
            <p className="mb-3 text-sm font-semibold">{t('usageThisMonth')}</p>
            {recentVisits.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('noVisits')}</p>
            ) : (
              <ul className="space-y-2">
                {recentVisits.slice(0, 5).map((v, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 text-foreground">{v.spaceName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {recentVisits.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('sessionsUsed', { count: recentVisits.length })}
                {creditsMax > 0 && `, ${t('remaining', { count: creditsRemaining })}`}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
