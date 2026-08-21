import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getDashboardData } from '@/server/metworkcrm/services/dashboard';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { DashboardNav, isDashboardViewKey } from '@/components/metworkcrm/dashboard/dashboard-nav';
import { TodayView } from '@/components/metworkcrm/dashboard/today-view';
import { UrgentView } from '@/components/metworkcrm/dashboard/urgent-view';
import { CommercialView } from '@/components/metworkcrm/dashboard/commercial-view';
import { EcosystemView } from '@/components/metworkcrm/dashboard/ecosystem-view';
import { OpenInnovationView } from '@/components/metworkcrm/dashboard/oi-view';
import { ProgramsView } from '@/components/metworkcrm/dashboard/programs-view';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ view?: string }>;
}

/**
 * Real dashboard (Prompt 6, replaces the Prompt 1 placeholder). "Aujourd'hui"
 * and "Urgent" are personal to the viewer; the other four views are
 * team-wide pipeline snapshots. All data is fetched server-side in one batch
 * (`getDashboardData`) — the `?view=` switcher below is plain server-rendered
 * links, no client refetch per tab.
 */
export default async function CrmDashboardPage({ searchParams }: PageProps) {
  const user = await requireCrmUser();
  const { view: rawView } = await searchParams;
  const view = isDashboardViewKey(rawView) ? rawView : 'today';
  const firstName = user.name.split(' ')[0] ?? user.name;

  const data = await getDashboardData(user);

  return (
    <>
      <CrmPageHeader title={`Bonjour, ${firstName}`} subtitle="Vue d'ensemble de votre activité." />
      <DashboardNav active={view} />
      {view === 'today' ? <TodayView data={data.today} /> : null}
      {view === 'urgent' ? <UrgentView data={data.urgent} /> : null}
      {view === 'commercial' ? <CommercialView data={data.commercial} /> : null}
      {view === 'ecosystem' ? <EcosystemView data={data.ecosystem} /> : null}
      {view === 'oi' ? <OpenInnovationView data={data.openInnovation} /> : null}
      {view === 'programs' ? <ProgramsView data={data.programs} /> : null}
    </>
  );
}
