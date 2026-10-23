/**
 * Monthly membership auto-renewal — THE one place a membership renews itself.
 *
 * Run daily by `/api/cron/membership-renewals`. For every ACTIVE membership
 * with `autoRenew` (monthly purchases only; annual and legacy records never
 * renew):
 *
 *   • 3 days or less before `expiresAt` — send the "renews soon" notice once
 *     per period (`renewalReminderSentAt`).
 *   • at or after `expiresAt` — debit one month at the plan's LIVE price from
 *     the member's wallet and open a new period with a fresh frozen snapshot.
 *     If the wallet is missing, frozen or short, or the plan is no longer on
 *     sale for the member's role, the membership lapses and the member drops
 *     to Free (same field footprint as the downgrade cron's FREE branch).
 *
 * A free Premium trial (`trial: true`) goes through the same loop: it gets
 * the 3-day notice and then ends — it is never charged.
 *
 * A member with a scheduled downgrade is skipped: that is how a monthly plan
 * is cancelled (see `/api/memberships/downgrade`), and the downgrade cron owns
 * the end of that period.
 *
 * Idempotent by construction: renewing or lapsing flips the old record to
 * EXPIRED inside the same `db.update`, so a second run finds nothing to charge.
 * Notices are sent AFTER the lock, from data captured inside it.
 */
import { randomUUID } from 'node:crypto';
import { db } from '@/server/db/store';
import { computePeriodEnd } from '@/lib/billing-cycles';
import { canPurchasePlan, tierForPlan, type PaidPlanCode } from '@/lib/membership-benefits';
import {
  normalizePlanCode,
  passCountFrom,
  planConfigsFrom,
  pricesForConfig,
} from '@/server/memberships/plan-config';
import {
  sendMembershipRenewalNotice,
  type MembershipRenewalNotice,
} from '@/server/notifications/mock';

/** Days before the period end the reminder goes out. */
export const RENEWAL_REMINDER_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RenewalRunResult {
  renewed: string[];
  lapsed: string[];
  reminded: string[];
  errors: string[];
}

type LapseReason = 'INSUFFICIENT_FUNDS' | 'PLAN_UNAVAILABLE' | 'TRIAL_ENDED';

export async function runMembershipRenewals(now = new Date()): Promise<RenewalRunResult> {
  const nowIso = now.toISOString();
  const result: RenewalRunResult = { renewed: [], lapsed: [], reminded: [], errors: [] };
  const notices: MembershipRenewalNotice[] = [];

  await db.update((d) => {
    const configs = planConfigsFrom(d);
    // Snapshot the list: renewing pushes new records onto the same array.
    const due = (d.userMemberships ?? []).filter(
      (m) => m.status === 'ACTIVE' && (m.autoRenew === true || m.trial === true) && !!m.expiresAt,
    );

    for (const m of due) {
      try {
        const user = d.users.find((u) => u.id === m.userId);
        if (!user) continue;
        if (user.scheduledMembershipChange) continue;

        const planCode = normalizePlanCode(m.plan);
        const config = planCode ? configs.find((c) => c.planCode === planCode) ?? null : null;
        const price = config ? pricesForConfig(config).monthly : 0;
        const expiresAt = new Date(m.expiresAt!);
        const recipient = {
          userId: user.id,
          email: user.email,
          phone: user.phone,
          fullName: user.fullName,
          locale: user.locale,
          plan: (planCode ?? 'STARTUP') as PaidPlanCode,
          amount: price,
        };

        // ── Not due yet: maybe remind ──────────────────────────────────────
        if (expiresAt > now) {
          if (!m.renewalReminderSentAt && expiresAt.getTime() - now.getTime() <= RENEWAL_REMINDER_DAYS * DAY_MS) {
            m.renewalReminderSentAt = nowIso;
            m.updatedAt = nowIso;
            const wallet = d.wallets.find((w) => w.userId === user.id);
            notices.push({
              ...recipient,
              kind: 'REMINDER',
              date: m.expiresAt!,
              trial: m.trial === true,
              walletShort: !m.trial && (!wallet || wallet.status === 'FROZEN' || wallet.balance < price),
            });
            result.reminded.push(m.id);
          }
          continue;
        }

        // ── Due: renew or lapse ────────────────────────────────────────────
        const wallet = d.wallets.find((w) => w.userId === user.id);
        let lapse: LapseReason | null = null;
        if (m.trial) {
          lapse = 'TRIAL_ENDED';
        } else if (!planCode || !config || !canPurchasePlan(user.role, planCode) || user.status !== 'ACTIVE') {
          lapse = 'PLAN_UNAVAILABLE';
        } else if (!wallet || wallet.status === 'FROZEN' || wallet.balance < price) {
          lapse = 'INSUFFICIENT_FUNDS';
        }

        m.status = 'EXPIRED';
        m.updatedAt = nowIso;

        if (lapse) {
          m.autoRenew = false;
          // Drop to Free — the full footprint, mirroring the FREE branch of
          // /api/cron/process-downgrades (clearing only the code would leave
          // the tier and the discount mirrors in place).
          user.membershipCode = null;
          user.membershipTier = 'EXPLORER';
          user.membershipExpiresAt = null;
          user.membershipStartDate = null;
          user.membershipRenewalDate = null;
          delete user.membershipSpaceDiscountRate;
          delete user.membershipConsultationDiscountRate;
          user.networkCredits = 0;
          user.networkCreditsMax = 0;
          user.networkPassesUsedThisMonth = 0;
          user.updatedAt = nowIso;
          notices.push({ ...recipient, kind: 'LAPSED', date: m.expiresAt!, reason: lapse, trial: m.trial === true });
          result.lapsed.push(m.id);
          continue;
        }

        // Periods chain end to end. If the cron was down for longer than a
        // month, the new period starts now instead of charging for months the
        // member could not use.
        let startsAt = m.expiresAt!;
        let endsAt = computePeriodEnd(startsAt, 'MONTHLY');
        if (new Date(endsAt) <= now) {
          startsAt = nowIso;
          endsAt = computePeriodEnd(startsAt, 'MONTHLY');
        }

        wallet!.balance -= price;
        wallet!.updatedAt = nowIso;
        d.transactions.push({
          id: randomUUID(),
          walletId: wallet!.id,
          userId: user.id,
          type: 'PAYMENT',
          amount: -price,
          balanceAfter: wallet!.balance,
          status: 'COMPLETED',
          description: `Membership — ${planCode} (monthly, auto-renewal)`,
          reference: `membership-renew-${m.id}`,
          provider: 'internal',
          providerTxnId: null,
          metadata: {
            membershipPlan: planCode,
            billingPeriod: 'monthly',
            discountPercent: 0,
            promoCodeId: null,
            basePrice: price,
            amountCharged: price,
            renewedFromId: m.id,
            auto: true,
          },
          createdAt: nowIso,
          completedAt: nowIso,
        });

        const creditsMax = passCountFrom(d, planCode!);
        d.userMemberships!.push({
          id: randomUUID(),
          userId: user.id,
          plan: planCode!,
          startsAt,
          expiresAt: endsAt,
          status: 'ACTIVE',
          createdAt: nowIso,
          updatedAt: nowIso,
          billingPeriod: 'monthly',
          basePrice: price,
          amountCharged: price,
          promoDiscountPercent: 0,
          // A renewal is a new period: it takes the plan's current terms.
          spaceDiscountRate: config!.spaceDiscountRate,
          consultationDiscountRate: config!.consultationDiscountRate,
          monthlyPassCount: creditsMax,
          snapshotAt: nowIso,
          autoRenew: true,
          renewedFromId: m.id,
        });

        user.membershipCode = planCode;
        user.membershipTier = tierForPlan(planCode!);
        user.membershipExpiresAt = endsAt;
        user.membershipStartDate = startsAt;
        user.membershipRenewalDate = endsAt;
        user.membershipSpaceDiscountRate = config!.spaceDiscountRate;
        user.membershipConsultationDiscountRate = config!.consultationDiscountRate;
        user.networkCreditsMax = creditsMax;
        user.networkCredits = Math.min(user.networkCredits ?? 0, creditsMax);
        user.updatedAt = nowIso;

        notices.push({ ...recipient, kind: 'RENEWED', date: endsAt });
        result.renewed.push(m.id);
      } catch (err) {
        result.errors.push(`membership ${m.id}: ${String(err)}`);
        console.error('[renewals] membership error', { membershipId: m.id, err });
      }
    }
  });

  // Self-catching senders; awaited so the lambda doesn't freeze mid-send.
  await Promise.allSettled(notices.map((n) => sendMembershipRenewalNotice(n)));
  return result;
}
