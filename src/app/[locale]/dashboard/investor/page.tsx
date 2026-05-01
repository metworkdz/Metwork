import { setRequestLocale } from 'next-intl/server';
import { Calendar, Rocket, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function InvestorDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['INVESTOR']);

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={`Welcome, ${user.fullName.split(' ')[0]}`}
        subtitle="Discover Algerian startups looking for capital."
        action={
          <Button asChild>
            <Link href="/dashboard/investor/startups">Browse startups</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Startups followed" value={0} icon={Rocket} />
        <StatCard label="Pending meetings" value={0} icon={Calendar} />
        <StatCard label="Investments" value={0} hint="Total committed" icon={TrendingUp} />
      </div>
    </div>
  );
}
