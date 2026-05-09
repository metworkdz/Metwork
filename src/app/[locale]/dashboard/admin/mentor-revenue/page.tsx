import { setRequestLocale, getTranslations } from 'next-intl/server';
import { TrendingUp, Users, DollarSign, Clock } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { db } from '@/server/db/store';
import { DEFAULT_COMMISSION_RULES } from '@/server/admin/settings-defaults';

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

  // Find the mentor consultation commission rate
  const consultationRule =
    data.commissionRules.find((r) => r.transactionType === 'MENTOR_CONSULTATION' && r.isActive) ??
    DEFAULT_COMMISSION_RULES.find((r) => r.transactionType === 'MENTOR_CONSULTATION');
  const platformRate = consultationRule?.rate ?? 0.30;
  const mentorRate   = 1 - platformRate;

  const bookings = data.mentorBookings ?? [];
  const approved  = bookings.filter((b) => b.status === 'APPROVED');
  const pending   = bookings.filter((b) => b.status === 'PENDING');

  // Aggregate per mentor
  type MentorStat = {
    id: string;
    name: string;
    fee: number;
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
    statMap.set(m.id, {
      id:             m.id,
      name:           m.fullName,
      fee:            m.consultationFee ?? 0,
      total:          0,
      approved:       0,
      pending:        0,
      rejected:       0,
      grossRevenue:   0,
      platformCut:    0,
      mentorEarnings: 0,
    });
  }

  for (const b of bookings) {
    const stat = statMap.get(b.mentorId);
    if (!stat) continue;
    stat.total++;
    if (b.status === 'APPROVED') {
      stat.approved++;
      stat.grossRevenue   += stat.fee;
      stat.platformCut    += Math.round(stat.fee * platformRate);
      stat.mentorEarnings += Math.round(stat.fee * mentorRate);
    } else if (b.status === 'PENDING') {
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
        subtitle={t('admin.mentorRevenue.subtitle', { platformRate: Math.round(platformRate * 100), mentorRate: Math.round(mentorRate * 100) })}
        action={<TrendingUp className="size-5 text-muted-foreground" />}
      />

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={<Users className="size-4" />}     label="Approved sessions"    value={String(approved.length)} />
        <SummaryCard icon={<Clock className="size-4" />}     label="Pending reviews"      value={String(pending.length)} />
        <SummaryCard icon={<DollarSign className="size-4" />} label="Platform revenue"     value={fmt(totalPlatform)} />
        <SummaryCard icon={<DollarSign className="size-4" />} label="Total mentor earnings" value={fmt(totalMentor)} />
      </div>

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
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Sessions</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Gross revenue</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Platform ({Math.round(platformRate * 100)}%)</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Mentor ({Math.round(mentorRate * 100)}%)</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((m) => (
                    <tr key={m.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium">{m.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.fee > 0 ? fmt(m.fee) : <span className="text-muted-foreground">Free</span>}
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
                      <td className="px-4 py-3" colSpan={3}>Total</td>
                      <td className="px-4 py-3 text-right tabular-nums">{fmt(totalGross)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{fmt(totalPlatform)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{fmt(totalMentor)}</td>
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
