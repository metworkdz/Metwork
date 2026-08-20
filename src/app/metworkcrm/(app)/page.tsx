import type { Metadata } from 'next';
import { Gauge } from 'lucide-react';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ComingSoon } from '@/components/metworkcrm/shared/coming-soon';

export const metadata: Metadata = { title: 'Tableau de bord' };
export const dynamic = 'force-dynamic';

/**
 * Placeholder dashboard. Real KPI widgets (Aujourd'hui / Urgent / Commercial /
 * Écosystème / Open Innovation / Programmes) land in Prompt 6.
 */
export default async function CrmDashboardPage() {
  const user = await requireCrmUser();
  const firstName = user.name.split(' ')[0] ?? user.name;

  return (
    <>
      <CrmPageHeader
        title={`Bonjour, ${firstName}`}
        subtitle="Vue d’ensemble de votre activité."
      />
      <ComingSoon
        title="Tableau de bord"
        description="Les indicateurs (Aujourd’hui, Urgent, Commercial, Écosystème, Open Innovation, Programmes) seront disponibles prochainement."
        icon={Gauge}
        prompt={6}
      />
    </>
  );
}
