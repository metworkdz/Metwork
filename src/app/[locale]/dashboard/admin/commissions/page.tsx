import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { CommissionsManager } from '@/components/features/admin/commissions-manager';
import { db, defaultPlatformConfig } from '@/server/db/store';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';
import {
  ensureMembershipPlanConfigs,
  passCountFrom,
} from '@/server/memberships/plan-config';
import type { Locale } from '@/i18n/config';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Commissions' };

export default async function AdminCommissionsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  // Seed default rules on first visit if the collection is empty, and
  // additively backfill any default rule TYPE a later release introduced
  // (e.g. MENTOR_CONSULTATION_SELF) — existing rules are never modified.
  const data = await db.read();
  let rules = data.commissionRules;
  const missingDefault = DEFAULT_COMMISSION_RULES.some(
    (def) => !rules.some((r) => r.transactionType === def.transactionType),
  );
  if (missingDefault) {
    rules = await db.update((store) => {
      for (const def of DEFAULT_COMMISSION_RULES) {
        if (!store.commissionRules.some((r) => r.transactionType === def.transactionType)) {
          store.commissionRules.push({ ...def });
        }
      }
      return store.commissionRules;
    });
  }

  // Seed membership plan configs the same way — additive, existing records
  // untouched. This call also performs the one-time legacy-terms snapshot
  // backfill that keeps pre-repricing members on the terms they bought.
  const planConfigs = await ensureMembershipPlanConfigs();
  const seeded = await db.read();
  const membershipPlans = planConfigs.map((config) => ({
    config,
    monthlyPassCount: passCountFrom(seeded, config.planCode),
  }));

  const cfg = { ...defaultPlatformConfig, ...seeded.meta?.platformConfig };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.commissions.title')}
        subtitle={t('admin.commissions.subtitle')}
        action={<TrendingUp className="size-5 text-muted-foreground" />}
      />
      <CommissionsManager
        rules={rules}
        receiverRate={cfg.receiverCommissionRate ?? 0.05}
        payerRate={cfg.payerFeeRate ?? 0.02}
        membershipPlans={membershipPlans}
        locale={locale as Locale}
      />
    </div>
  );
}
