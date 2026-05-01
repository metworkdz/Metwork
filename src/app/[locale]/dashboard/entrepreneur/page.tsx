import { setRequestLocale } from 'next-intl/server';
import { Briefcase, Calendar, Rocket, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth-guards';
import { DashboardWelcome } from '@/components/shared/dashboard-welcome';
import { StatCard } from '@/components/shared/stat-card';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurDashboard({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireRole(['ENTREPRENEUR']);

  return (
    <div className="space-y-6">
      <DashboardWelcome
        greeting={`Welcome back, ${user.fullName.split(' ')[0]} 👋`}
        subtitle="Here's what's happening with your startup journey."
        action={
          <Button asChild>
            <Link href="/spaces">Book a space</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active bookings" value={0} icon={Calendar} />
        <StatCard label="Programs" value={0} icon={Briefcase} />
        <StatCard
          label="Wallet"
          value="0 DZD"
          hint="Available balance"
          icon={Wallet}
        />
        <StatCard
          label="Startup status"
          value={user.membershipCode === 'STARTUP' ? 'Listed' : 'Not listed'}
          hint={user.membershipCode === 'STARTUP' ? '' : 'Upgrade to list'}
          icon={Rocket}
        />
      </div>
    </div>
  );
}
