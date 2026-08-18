import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp, Users, DollarSign, Clock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db } from '@/server/db/store';
import { resolveMentorCommissionRates } from '@/server/payments/mentor-commission';
import { getConsultationRevenueSummary } from '@/server/mentors/revenue';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Mentor Revenue' };

export default async function AdminMentorRevenuePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const data = await db.read();

  // Authoritative settled-money P&L from the consultant ledger (one COMMISSION
  // row per settled booking froze the full promo split + absorbed discounts).
  const revenue = await getConsultationRevenueSummary();
  const subsidyByMentor = new Map(revenue.perMentor.map((m) => [m.mentorId, m]));

  // ONE consultation rate for every consultant (the separate self-signup tier
  // was retired when the standard rate itself became 20 %). Comes from the SAME
  // resolver settlement uses, so this page always previews what the ledger will
  // actually do. Configurable on the Commissions page.
  const standardRates = resolveMentorCommissionRates(data.commissionRules);
  const { platformRate, mentorRate } = standardRates;

  const bookings = data.mentorBookings ?? [];
  const approved  = bookings.filter((b) => b.status === 'APPROVED');
  const pending   = bookings.filter((b) => b.status === 'PENDING');

  // Aggregate per mentor
  type MentorStat = {
    id: string;
    name: string;
    fee: number;
    /** 'SELF' = portal self-signup (new-consultant rate). */
    source: 'ADMIN' | 'SELF';
    approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    platformRate: number;
    mentorRate: number;
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    grossRevenue: number;
    platformCut: number;
    mentorEarnings: number;
  };

  const statMap = new Map<string, MentorStat>();
  for (const m of data.mentors ?? []) {
    const source = m.source === 'SELF' ? 'SELF' as const : 'ADMIN' as const;
    const rates = standardRates;
    statMap.set(m.id, {
      id:             m.id,
      name:           m.fullName,
      fee:            m.consultationFee ?? 0,
      source,
      approvalStatus: m.approvalStatus ?? 'APPROVED',
      platformRate:   rates.platformRate,
      mentorRate:     rates.mentorRate,
      total:          0,
      approved:       0,
      pending:        0,
      rejected:       0,
      grossRevenue:   0,
      platformCut:    0,
      mentorEarnings: 0,
    });
  }

  // "Earned" = a paid/active consultation: legacy APPROVED + the instant-book
  // lifecycle states (CONFIRMED/READY/COMPLETED). Gross uses the real
  // amountCharged when present (instant-book), falling back to the hourly fee
  // for legacy rows. "Pending" = not yet settled; everything else (REJECTED /
  // CANCELLED) counts as dropped.
  const EARNED = new Set(['APPROVED', 'CONFIRMED', 'READY', 'COMPLETED']);
  const PENDING = new Set(['PENDING', 'PENDING_PAYMENT', 'AWAITING_PAYMENT', 'AWAITING_LINK']);
  for (const b of bookings) {
    const stat = statMap.get(b.mentorId);
    if (!stat) continue;
    stat.total++;
    if (EARNED.has(b.status)) {
      stat.approved++;
      const gross = b.amountCharged ?? stat.fee;
      stat.grossRevenue   += gross;
      // Per-mentor rate (standard vs self-signup tier).
      stat.platformCut    += Math.round(gross * stat.platformRate);
      stat.mentorEarnings += Math.round(gross * stat.mentorRate);
    } else if (PENDING.has(b.status)) {
      stat.pending++;
    } else {
      stat.rejected++;
    }
  }

  const stats = [...statMap.values()].sort((a, b) => b.approved - a.approved);

  const totalGross    = stats.reduce((s, m) => s + m.grossRevenue, 0);
  const totalPlatform = stats.reduce((s, m) => s + m.platformCut, 0);
  const totalMentor   = stats.reduce((s, m) => s + m.mentorEarnings, 0);

  const fmt = (n: number) => `${n.toLocaleString()} DZD`;

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.mentorRevenue.title')}
        subtitle={t('admin.mentorRevenue.subtitleDual', {
          platformRate: Math.round(platformRate * 100),
          mentorRate: Math.round(mentorRate * 100),
        })}
        action={<TrendingUp className="size-5 text-muted-foreground" />}
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={<Users className="size-4" />}     label="Approved sessions"    value={String(approved.length)} />
        <SummaryCard icon={<Clock className="size-4" />}     label="Pending reviews"      value={String(pending.length)} />
        <SummaryCard icon={<DollarSign className="size-4" />} label="Platform revenue"     value={fmt(totalPlatform)} />
        <SummaryCard icon={<DollarSign className="size-4" />} label="Total mentor earnings" value={fmt(totalMentor)} />
      </div>

      {/* Settled-money P&L (authoritative, from the consultant ledger) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('admin.mentorRevenue.revenueTitle')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('admin.mentorRevenue.revenueSubtitle')}</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={<DollarSign className="size-4" />}
              label={t('admin.mentorRevenue.grossCommission')}
              value={fmt(revenue.grossCommission)}
            />
            <SummaryCard
              icon={<DollarSign className="size-4" />}
              label={t('admin.mentorRevenue.promoSubsidy')}
              value={`− ${fmt(revenue.promoSubsidy)}`}
            />
            <SummaryCard
              icon={<DollarSign className="size-4" />}
              label={t('admin.mentorRevenue.tierSubsidy')}
              value={`− ${fmt(revenue.tierSubsidy)}`}
            />
            <SummaryCard
              icon={<TrendingUp className="size-4" />}
              label={t('admin.mentorRevenue.netPlatformRevenue')}
              value={fmt(revenue.netPlatformRevenue)}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('admin.mentorRevenue.subsidyNote', {
              collected: fmt(revenue.totalCollected),
              consultant: fmt(revenue.totalConsultantEarnings),
              count: revenue.settledCount,
            })}
          </p>
        </CardContent>
      </Card>

      {/* Per-mentor table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-mentor breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {stats.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No mentors yet. Add mentors from the Mentors page.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/30">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mentor</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Fee / session</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t('admin.mentorRevenue.commissionCol')}</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Sessions</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross revenue</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Platform</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Mentor</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">{t('admin.mentorRevenue.promoSubsidyShort')}</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((m) => (
                    <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">
                        {m.name}
                        {m.source === 'SELF' && (
                          <Badge variant="info" className="ms-2 text-[10px]">
                            {t('admin.mentorRevenue.selfSignupBadge')}
                          </Badge>
                        )}
                        {m.approvalStatus === 'PENDING' && (
                          <Badge variant="warning" className="ms-2 text-[10px]">
                            {t('admin.mentorRevenue.pendingApprovalBadge')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.fee > 0 ? fmt(m.fee) : <span className="text-muted-foreground">Free</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {Math.round(m.platformRate * 100)}%
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <span className="font-semibold text-foreground">{m.approved}</span>
                        {m.pending > 0 && (
                          <span className="ml-1 text-xs text-amber-600">+{m.pending} pending</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{m.grossRevenue > 0 ? fmt(m.grossRevenue) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{m.platformCut > 0 ? fmt(m.platformCut) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-emerald-700">
                        {m.mentorEarnings > 0 ? fmt(m.mentorEarnings) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-600">
                        {(subsidyByMentor.get(m.id)?.promoSubsidy ?? 0) > 0
                          ? `− ${fmt(subsidyByMentor.get(m.id)!.promoSubsidy)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {m.total === 0 ? (
                          <Badge variant="outline" className="text-xs">No bookings</Badge>
                        ) : m.approved > 0 ? (
                          <Badge variant="success" className="text-xs">{m.approved} approved</Badge>
                        ) : (
                          <Badge variant="warning" className="text-xs">{m.pending} pending</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {stats.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                      <td className="px-4 py-3" colSpan={4}>Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totalGross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(totalPlatform)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{fmt(totalMentor)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-amber-600">
                        {revenue.promoSubsidy > 0 ? `− ${fmt(revenue.promoSubsidy)}` : '—'}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-semibold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
