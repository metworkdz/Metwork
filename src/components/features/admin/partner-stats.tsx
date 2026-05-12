'use client';

/**
 * Admin component — view aggregate stats for a single partner space.
 *
 * Rendered inside a parent page that passes the partnerId prop,
 * or used as a standalone section inside the PartnerManagement view.
 */

import { useEffect, useState } from 'react';
import { BarChart2, Users, TrendingUp, Tag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PartnerStats {
  partnerId: string;
  spaceId: string;
  spaceName: string;
  totalVisits: number;
  visitsThisMonth: number;
  totalPayoutEarned: number;
  pendingPayout: number;
  promoCodesIssued: number;
  promoCodesRedeemed: number;
  uniqueReferrals: number;
  dailyVisits: Array<{ date: string; count: number }>;
}

interface Props {
  partnerId: string;
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div className="rounded-lg bg-zinc-100 p-2.5 text-zinc-600">{icon}</div>
        <div>
          <div className="text-sm text-zinc-500">{label}</div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums">{value}</div>
          {sub && <div className="text-xs text-zinc-400">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Mini bar chart ──────────────────────────────────────────────────────────

function MiniBar({ daily }: { daily: Array<{ date: string; count: number }> }) {
  const max = Math.max(...daily.map((d) => d.count), 1);
  const last14 = daily.slice(-14);

  return (
    <Card>
      <CardContent className="p-5">
        <div className="mb-3 text-sm font-semibold">Daily check-ins (last 14 days)</div>
        <div className="flex h-20 items-end gap-1">
          {last14.map((d) => (
            <div key={d.date} className="group relative flex flex-1 flex-col items-center">
              <div
                className="w-full rounded-t bg-green-500 opacity-80 transition-opacity group-hover:opacity-100"
                style={{ height: `${Math.max(4, (d.count / max) * 72)}px` }}
              />
              <div className="absolute bottom-full mb-1 hidden rounded bg-zinc-800 px-1.5 py-1 text-xs text-white group-hover:block whitespace-nowrap">
                {d.date.slice(5)}: {d.count}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-zinc-400">
          <span>{last14[0]?.date.slice(5) ?? ''}</span>
          <span>{last14[last14.length - 1]?.date.slice(5) ?? ''}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function PartnerStats({ partnerId }: Props) {
  const [stats, setStats] = useState<PartnerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/partners/${encodeURIComponent(partnerId)}?includeStats=true`)
      .then((r) => r.json())
      .then((d) => setStats(d.stats ?? null))
      .catch(() => setError('Failed to load stats'))
      .finally(() => setLoading(false));
  }, [partnerId]);

  if (loading) return <div className="py-8 text-center text-sm text-zinc-500">Loading stats…</div>;
  if (error)   return <div className="py-4 text-sm text-red-600">{error}</div>;
  if (!stats)  return null;

  const fmt = (n: number) => n.toLocaleString();
  const dzd = (n: number) => `${n.toLocaleString()} DZD`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          label="Total check-ins"
          value={fmt(stats.totalVisits)}
          sub={`${fmt(stats.visitsThisMonth)} this month`}
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Total payout earned"
          value={dzd(stats.totalPayoutEarned)}
          sub={`${dzd(stats.pendingPayout)} pending`}
        />
        <StatCard
          icon={<Tag className="h-5 w-5" />}
          label="Promo codes issued"
          value={fmt(stats.promoCodesIssued)}
          sub={`${fmt(stats.promoCodesRedeemed)} redeemed`}
        />
        <StatCard
          icon={<BarChart2 className="h-5 w-5" />}
          label="Unique referrals"
          value={fmt(stats.uniqueReferrals)}
          sub="Users joined via this partner"
        />
      </div>

      {stats.dailyVisits.length > 0 && <MiniBar daily={stats.dailyVisits} />}
    </div>
  );
}
