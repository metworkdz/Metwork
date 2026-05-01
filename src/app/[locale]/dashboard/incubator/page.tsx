import { setRequestLocale } from 'next-intl/server';
import { Building2, Calendar, TrendingUp, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={`Hello, ${user.fullName.split(' ')[0]}`}
        subtitle="Manage your spaces, programs, and bookings."
        action={
          <Button asChild>
            <Link href="/dashboard/incubator/spaces">Manage spaces</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active spaces" value={0} icon={Building2} />
        <StatCard label="Bookings this month" value={0} icon={Calendar} />
        <StatCard label="Revenue (MTD)" value="0 DZD" hint="After commissions" icon={TrendingUp} />
        <StatCard label="Wallet" value="0 DZD" icon={Wallet} />
      </div>
    </div>
  );
}
