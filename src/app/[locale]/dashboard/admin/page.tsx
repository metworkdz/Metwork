import { setRequestLocale } from 'next-intl/server';
import { Building2, TrendingUp, Users, Wallet } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function AdminDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['ADMIN']);

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting="Metwork admin"
        subtitle="Platform-wide stats and controls."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total users" value={0} icon={Users} />
        <StatCard label="Active incubators" value={0} icon={Building2} />
        <StatCard
          label="Platform revenue (MTD)"
          value="0 DZD"
          hint="Commissions + subscriptions"
          icon={TrendingUp}
        />
        <StatCard label="Wallet float" value="0 DZD" hint="Total held" icon={Wallet} />
      </div>
    </div>
  );
}
