/**
 * Network Pass Credit Service.
 *
 * Manages the monthly credit allowance (3 for Builder, 10 for Founder) used
 * to redeem coworking visits at partner spaces via the Network Pass system.
 *
 * Conventions:
 * - Follows the project's plain-function export style (no classes).
 * - Uses `db.read()` / `db.update()` — no Prisma.
 * - Writes are serialised by `db.update`'s write-queue so concurrent
 *   deductions within the same invocation can't race.
 * - All methods catch and log errors; `resetMonthlyCredits` never throws.
 * - Credit config is stored in `meta.platformConfig` and cached for 1 hour
 *   in the module-level `configCache` variable.
 *
 * Location note: this file lives under `src/server/network/` to follow the
 * project's server-domain convention (`src/server/<domain>/service.ts`).
 * The spec asked for `src/services/CreditService.ts` — a re-export is added
 * at that path for any code that imports from there.
 */

import {
  db,
  defaultPlatformConfig,
  type MembershipTier,
  type UserRecord,
} from '@/server/db/store';
import { appendAuditLog } from '@/server/audit/service';
import { resolveMemberBenefits } from '@/server/memberships/service';
import { isNetworkPassEnabled } from '@/config/feature-flags';
import { createNotification } from '@/server/notifications/create-notification';
import {
  sendResendEmail,
  creditLowWarningEmailHtml,
  creditExpiryReminderEmailHtml,
  monthlyCreditsResetEmailHtml,
} from '@/server/notifications/email';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserCreditsInfo {
  current: number;
  max: number;
  resetDate: Date;
  expiresOn: Date;
  tier: MembershipTier;
  usedThisMonth: number;
}

export interface DeductCreditResult {
  success: boolean;
  creditsRemaining: number;
  reason?: string;
}

export interface ResetCreditsResult {
  usersReset: number;
  timestamp: string;
  errors: string[];
}

export interface CreditConfig {
  builderCredits: number;
  founderCredits: number;
  lastUpdated: string;
  updatedBy?: string;
}

export interface SetCreditConfigResult {
  success: boolean;
  newConfig: { builderCredits: number; founderCredits: number };
}

// ---------------------------------------------------------------------------
// Internal config cache (1 hour TTL)
// ---------------------------------------------------------------------------

interface ConfigCache {
  config: CreditConfig;
  cachedAt: number;
}

let _configCache: ConfigCache | null = null;
const CONFIG_CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

function invalidateConfigCache(): void {
  _configCache = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns midnight UTC on the 1st of the month following `from`.
 * E.g. if today is 2026-05-12, returns 2026-06-01T00:00:00Z.
 */
function nextFirstOfMonth(from: Date = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
}

/**
 * Returns midnight UTC on the last calendar day of the same month as `from`.
 * E.g. if today is 2026-05-12, returns 2026-05-31T00:00:00Z.
 */
function lastDayOfMonth(from: Date = new Date()): Date {
  // Day 0 of next month === last day of current month
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
}

/**
 * Returns the YYYY-MM string for the month of `d` (UTC).
 * E.g. 2026-05.
 */
function yearMonth(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Read the effective membership tier from a UserRecord.
 * Falls back to EXPLORER when no tier is set (legacy accounts).
 */
function resolvedTier(user: UserRecord): MembershipTier {
  return user.membershipTier ?? 'EXPLORER';
}

// ---------------------------------------------------------------------------
// 1. getUserCredits
// ---------------------------------------------------------------------------

/**
 * Returns the current credit snapshot for a user.
 *
 * Does NOT write to the DB — purely a read operation.
 */
export async function getUserCredits(userId: string): Promise<UserCreditsInfo> {
  const data = await db.read();
  const user = data.users.find((u) => u.id === userId);
  if (!user) throw new Error(`getUserCredits: user ${userId} not found`);

  const tier = resolvedTier(user);
  // Snapshot-aware, so a grandfathered member sees the allowance they bought
  // rather than the current plan's.
  const max = resolveMemberBenefits(data, user).monthlyPassCount;

  const now = new Date();
  const resetDate = nextFirstOfMonth(now);
  const expiresOn = lastDayOfMonth(now);

  return {
    current: user.networkCredits ?? 0,
    max,
    resetDate,
    expiresOn,
    tier,
    usedThisMonth: user.networkPassesUsedThisMonth ?? 0,
  };
}

// ---------------------------------------------------------------------------
// 2. deductCredit
// ---------------------------------------------------------------------------

/**
 * Atomically deducts `amount` (default 1) credits from the user's balance.
 *
 * Returns `success: false` with a human-readable `reason` when the
 * deduction cannot be performed — callers must check `success` before
 * proceeding with the booking.
 */
export async function deductCredit(
  userId: string,
  amount = 1,
): Promise<DeductCreditResult> {
  // ── Validate amount ──────────────────────────────────────────────────────
  if (!Number.isInteger(amount) || amount < 1 || amount > 10) {
    return { success: false, creditsRemaining: 0, reason: 'Invalid amount: must be 1–10' };
  }

  try {
    return await db.update((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (!user) {
        return { success: false, creditsRemaining: 0, reason: 'User not found' };
      }

      const tier = resolvedTier(user);
      if (tier === 'EXPLORER') {
        return {
          success: false,
          creditsRemaining: 0,
          reason: 'Network Pass is not available on the Explorer plan. Upgrade to Builder or Founder.',
        };
      }

      const current = user.networkCredits ?? 0;
      if (current < amount) {
        return {
          success: false,
          creditsRemaining: current,
          reason: current === 0
            ? 'Insufficient credits: you have no network pass credits left this month.'
            : `Insufficient credits: you only have ${current} credit${current !== 1 ? 's' : ''} left.`,
        };
      }

      // ── Apply deduction ─────────────────────────────────────────────────
      user.networkCredits = current - amount;
      user.networkPassesUsedThisMonth = (user.networkPassesUsedThisMonth ?? 0) + amount;
      user.lastNetworkVisit = new Date().toISOString();

      return { success: true, creditsRemaining: user.networkCredits };
    });
  } catch (err) {
    console.error('[credits] deductCredit failed', { userId, amount, err });
    return { success: false, creditsRemaining: 0, reason: 'Internal error — please try again.' };
  }
}

// ---------------------------------------------------------------------------
// 3. resetMonthlyCredits
// ---------------------------------------------------------------------------

/**
 * Resets network pass credits for all Builder and Founder users.
 *
 * Designed to run on the 1st of each month at 00:00 UTC via Vercel Cron
 * (`0 0 1 * *`). Idempotent: running it twice in the same minute resets to
 * `max` both times, which is safe.
 *
 * Never throws — all per-user errors are collected and returned.
 */
export async function resetMonthlyCredits(): Promise<ResetCreditsResult> {
  const timestamp = new Date().toISOString();
  const errors: string[] = [];
  let usersReset = 0;

  try {
    const nextReset = nextFirstOfMonth(new Date()).toISOString();

    await db.update((d) => {
      for (const user of d.users) {
        const tier = resolvedTier(user);
        if (tier === 'EXPLORER') continue;

        try {
          // Snapshot-aware: a member grandfathered on a larger allowance keeps
          // it for the life of their billing period. Reading the live config
          // here directly would silently downgrade them on the 1st of a month.
          const max = resolveMemberBenefits(d, user).monthlyPassCount;
          user.networkCredits = max;
          user.networkCreditsMax = max;
          user.networkCreditsResetDate = nextReset;
          user.networkPassesUsedThisMonth = 0;
          user.networkSpacesVisited = [];
          // Clear low-credit warning so it can fire again next month
          user.lastLowCreditWarningDate = null;
          usersReset++;
        } catch (userErr) {
          const msg = `Failed to reset credits for user ${user.id}: ${String(userErr)}`;
          errors.push(msg);
          console.error('[credits] resetMonthlyCredits user error', { userId: user.id, err: userErr });
        }
      }
    });

    // Fire-and-forget: send reset notification emails (best-effort)
    void sendResetNotifications();

    console.info(`[credits] Monthly reset complete — ${usersReset} users reset`, { timestamp });
  } catch (err) {
    const msg = `resetMonthlyCredits top-level error: ${String(err)}`;
    errors.push(msg);
    console.error('[credits] resetMonthlyCredits failed', err);
  }

  return { usersReset, timestamp, errors };
}

/**
 * Best-effort: send in-app notifications for credit reset.
 * Email sending is attempted but errors are swallowed.
 */
async function sendResetNotifications(): Promise<void> {
  // Credits keep accruing while the feature is off (so nobody's balance is
  // silently lost), but telling people about a pass they cannot redeem would
  // be worse than silence.
  if (!isNetworkPassEnabled()) return;
  try {
    const data = await db.read();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';

    // Members on a 0-pass plan (Builder) have nothing to be told about — a
    // "you now have 0 credits" message would be noise, not a notification.
    const eligible = data.users.filter((u) => {
      const tier = resolvedTier(u);
      if (tier === 'EXPLORER') return false;
      return resolveMemberBenefits(data, u).monthlyPassCount > 0;
    });

    await Promise.allSettled(
      eligible.map(async (user) => {
        const tier = resolvedTier(user);
        const newCredits = resolveMemberBenefits(data, user).monthlyPassCount;

        // In-app notification
        await createNotification({
          userId: user.id,
          type: 'NETWORK_CREDITS_RESET',
          title: 'Monthly credits refreshed',
          body: `You now have ${newCredits} network pass credit${newCredits !== 1 ? 's' : ''} for this month.`,
          href: '/dashboard/entrepreneur/membership',
        });

        // Email notification (fire-and-forget per user)
        const sent = await sendResendEmail({
          to: user.email,
          subject: `Your ${newCredits} Metwork network credits are ready`,
          html: monthlyCreditsResetEmailHtml({
            fullName: user.fullName,
            email: user.email,
            newCredits,
            tier: tier as 'BUILDER' | 'FOUNDER',
            spacesUrl: `${appUrl}/spaces`,
          }),
        });
        if (!sent) {
          console.info('[credits] Resend not configured — skipping reset email for', user.id);
        }
      }),
    );
  } catch (err) {
    console.error('[credits] sendResetNotifications failed', err);
  }
}

// ---------------------------------------------------------------------------
// 4. getAdminCreditConfig
// ---------------------------------------------------------------------------

/**
 * Returns the current admin-set credit allowances.
 * Reads from `meta.platformConfig` in the DB, with a 1-hour in-memory cache.
 */
export async function getAdminCreditConfig(): Promise<CreditConfig> {
  // Return cached config if still fresh
  if (_configCache && Date.now() - _configCache.cachedAt < CONFIG_CACHE_TTL_MS) {
    return _configCache.config;
  }

  const data = await db.read();
  const pc = data.meta?.platformConfig ?? defaultPlatformConfig;

  const config: CreditConfig = {
    builderCredits: pc.builderMonthlyCredits ?? defaultPlatformConfig.builderMonthlyCredits!,
    founderCredits: pc.founderMonthlyCredits ?? defaultPlatformConfig.founderMonthlyCredits!,
    lastUpdated: pc.creditConfigUpdatedAt ?? data.meta?.platformConfig ? new Date(0).toISOString() : new Date().toISOString(),
    updatedBy: pc.creditConfigUpdatedBy,
  };

  _configCache = { config, cachedAt: Date.now() };
  return config;
}

// ---------------------------------------------------------------------------
// 5. setAdminCreditConfig
// ---------------------------------------------------------------------------

/**
 * Updates the monthly credit allowances. Validates the caller is an ADMIN,
 * persists to `meta.platformConfig`, clears the config cache, and appends
 * an audit log entry.
 */
export async function setAdminCreditConfig(
  builderAmount: number,
  founderAmount: number,
  adminId: string,
): Promise<SetCreditConfigResult> {
  // ── Validate inputs ──────────────────────────────────────────────────────
  // 0 is a valid allowance — the Builder plan no longer includes coworking
  // passes, so the lower bound is 0 rather than 1.
  if (!Number.isInteger(builderAmount) || builderAmount < 0 || builderAmount > 100) {
    throw new Error('builderAmount must be an integer between 0 and 100');
  }
  if (!Number.isInteger(founderAmount) || founderAmount < 0 || founderAmount > 100) {
    throw new Error('founderAmount must be an integer between 0 and 100');
  }

  const data = await db.read();
  const admin = data.users.find((u) => u.id === adminId);
  if (!admin || admin.role !== 'ADMIN') {
    throw new Error(`setAdminCreditConfig: user ${adminId} is not an ADMIN`);
  }

  const previous = await getAdminCreditConfig();
  const now = new Date().toISOString();

  await db.update((d) => {
    if (!d.meta) d.meta = {};
    const existing = d.meta.platformConfig ?? { ...defaultPlatformConfig };
    d.meta.platformConfig = {
      ...existing,
      builderMonthlyCredits: builderAmount,
      founderMonthlyCredits: founderAmount,
      creditConfigUpdatedAt: now,
      creditConfigUpdatedBy: adminId,
    };
  });

  // Clear 1-hour cache so next read sees new values immediately
  invalidateConfigCache();

  // Append audit trail
  await appendAuditLog({
    adminId,
    adminEmail: admin.email,
    action: 'CREDIT_CONFIG_UPDATED',
    targetType: 'platform_config',
    targetId: 'credit_config',
    details: {
      previous: { builderCredits: previous.builderCredits, founderCredits: previous.founderCredits },
      updated: { builderCredits: builderAmount, founderCredits: founderAmount },
    },
  });

  console.info(
    `[credits] Admin ${adminId} changed credit config: Builder ${previous.builderCredits}→${builderAmount}, Founder ${previous.founderCredits}→${founderAmount}`,
  );

  return {
    success: true,
    newConfig: { builderCredits: builderAmount, founderCredits: founderAmount },
  };
}

// ---------------------------------------------------------------------------
// 6. sendCreditLowWarning
// ---------------------------------------------------------------------------

/**
 * Sends a low-credit warning to the user if they have fewer than 2 credits
 * AND have not been warned already this calendar month.
 *
 * Safe to call on every booking deduction — it self-throttles.
 */
export async function sendCreditLowWarning(userId: string): Promise<void> {
  if (!isNetworkPassEnabled()) return;
  try {
    const data = await db.read();
    const user = data.users.find((u) => u.id === userId);
    if (!user) return;

    const tier = resolvedTier(user);
    if (tier === 'EXPLORER') return;

    const credits = user.networkCredits ?? 0;
    if (credits >= 2) return; // Not low yet

    // Check if already warned this month
    const thisMonth = yearMonth(new Date());
    const lastWarn = user.lastLowCreditWarningDate;
    if (lastWarn && lastWarn.startsWith(thisMonth)) return; // Already sent

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
    const now = new Date();

    // Mark as warned first (prevents double-send even if email fails)
    await db.update((d) => {
      const u = d.users.find((u2) => u2.id === userId);
      if (u) u.lastLowCreditWarningDate = now.toISOString();
    });

    // In-app notification
    await createNotification({
      userId,
      type: 'NETWORK_CREDIT_LOW',
      title: credits === 0 ? 'No network credits left' : `Only ${credits} credit${credits !== 1 ? 's' : ''} remaining`,
      body: credits === 0
        ? 'You have no network pass credits left this month.'
        : `You only have ${credits} network pass credit${credits !== 1 ? 's' : ''} left this month.`,
      href: '/dashboard/entrepreneur/membership',
    });

    // Email warning
    const sent = await sendResendEmail({
      to: user.email,
      subject: credits === 0
        ? 'You\'ve used all your Metwork network credits'
        : `Only ${credits} Metwork network credit${credits !== 1 ? 's' : ''} left`,
      html: creditLowWarningEmailHtml({
        fullName: user.fullName,
        email: user.email,
        creditsRemaining: credits,
        tier: tier as 'BUILDER' | 'FOUNDER',
        resetDate: nextFirstOfMonth(now),
        upgradeUrl: `${appUrl}/pricing`,
      }),
    });

    if (!sent) {
      console.info('[credits] Resend not configured — low-credit warning not emailed for', userId);
    }
  } catch (err) {
    // Never crash the caller
    console.error('[credits] sendCreditLowWarning failed', { userId, err });
  }
}

// ---------------------------------------------------------------------------
// 7. getCreditsExpiringToday
// ---------------------------------------------------------------------------

/**
 * Returns all Builder/Founder users whose credits expire today (i.e. today
 * is the last day of the month). Used by the daily expiry-reminder job.
 *
 * Logic: credits expire on the last day of each month at midnight UTC.
 * We check if `Date.now()` falls within the last calendar day of the month.
 */
export async function getCreditsExpiringToday(): Promise<UserRecord[]> {
  const now = new Date();
  const lastDay = lastDayOfMonth(now);

  // True only on the last day of the month (day matches, same month+year)
  const isLastDayOfMonth =
    now.getUTCDate() === lastDay.getUTCDate() &&
    now.getUTCMonth() === lastDay.getUTCMonth() &&
    now.getUTCFullYear() === lastDay.getUTCFullYear();

  if (!isLastDayOfMonth) return [];

  const data = await db.read();
  return data.users.filter((u) => {
    const tier = resolvedTier(u);
    return tier !== 'EXPLORER' && (u.networkCredits ?? 0) > 0;
  });
}

/**
 * Sends expiry reminder emails to all users with credits expiring today.
 * Designed to be called by the daily cron job (`0 9 * * *` UTC).
 */
export async function sendExpiryReminders(): Promise<{ sent: number; errors: string[] }> {
  if (!isNetworkPassEnabled()) return { sent: 0, errors: [] };
  const users = await getCreditsExpiringToday();
  if (users.length === 0) return { sent: 0, errors: [] };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
  let sent = 0;
  const errors: string[] = [];

  await Promise.allSettled(
    users.map(async (user) => {
      try {
        const tier = resolvedTier(user) as 'BUILDER' | 'FOUNDER';
        const credits = user.networkCredits ?? 0;

        await createNotification({
          userId: user.id,
          type: 'NETWORK_CREDIT_LOW',
          title: 'Last day to use your network credits!',
          body: `You have ${credits} credit${credits !== 1 ? 's' : ''} expiring tonight at midnight UTC.`,
          href: '/spaces',
        });

        const ok = await sendResendEmail({
          to: user.email,
          subject: `Last day! You have ${credits} Metwork credit${credits !== 1 ? 's' : ''} expiring tonight`,
          html: creditExpiryReminderEmailHtml({
            fullName: user.fullName,
            email: user.email,
            creditsRemaining: credits,
            tier,
            spacesUrl: `${appUrl}/spaces`,
          }),
        });

        if (ok) sent++;
      } catch (err) {
        const msg = `Expiry reminder failed for ${user.id}: ${String(err)}`;
        errors.push(msg);
        console.error('[credits] sendExpiryReminders user error', { userId: user.id, err });
      }
    }),
  );

  console.info(`[credits] Expiry reminders: ${sent}/${users.length} sent`);
  return { sent, errors };
}
