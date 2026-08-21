import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getReportsData } from '@/server/metworkcrm/services/reports';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { SalesKpisSection } from '@/components/metworkcrm/reports/sales-kpis';
import { OperationsKpisSection } from '@/components/metworkcrm/reports/operations-kpis';
import { StartupsKpisSection } from '@/components/metworkcrm/reports/startups-kpis';
import { EcosystemKpisSection } from '@/components/metworkcrm/reports/ecosystem-kpis';
import { OpenInnovationKpisSection } from '@/components/metworkcrm/reports/oi-kpis';
import { ProgramsKpisSection } from '@/components/metworkcrm/reports/programs-kpis';

export const metadata: Metadata = { title: 'Rapports' };
export const dynamic = 'force-dynamic';

/**
 * All-time / current-state KPI snapshots (owner decision — no date-range
 * picker in this pass). Money figures are redacted for TEAM_MEMBER inside
 * `getReportsData` itself (dev rules R-19 extended, product spec A-5), not
 * here — every section renders "—" rather than a hidden-but-present amount.
 */
export default async function CrmReportsPage() {
  const user = await requireCrmUser();
  const data = await getReportsData(user);

  return (
    <>
      <CrmPageHeader title="Rapports" subtitle="Indicateurs clés, vue d'ensemble." />
      <div className="space-y-6">
        <SalesKpisSection data={data.sales} />
        <OperationsKpisSection data={data.operations} />
        <StartupsKpisSection data={data.startups} />
        <EcosystemKpisSection data={data.ecosystem} />
        <OpenInnovationKpisSection data={data.openInnovation} />
        <ProgramsKpisSection data={data.programs} />
      </div>
    </>
  );
}
