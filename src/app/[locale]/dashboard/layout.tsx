import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session';
import { DashboardSidebar } from '@/components/layout/dashboard-sidebar';
import { DashboardTopbar } from '@/components/layout/dashboard-topbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getServerSession();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen bg-muted/20">
      <DashboardSidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopbar user={user} />
        <main className="flex-1 min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
