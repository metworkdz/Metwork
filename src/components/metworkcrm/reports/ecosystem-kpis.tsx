import type { EcosystemKpis } from '@/server/metworkcrm/services/reports';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';

export function EcosystemKpisSection({ data }: { data: EcosystemKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Écosystème</h2>
      <KpiGrid>
        <KpiTile label="Partenaires" value={data.partners} />
        <KpiTile label="Experts" value={data.experts} />
        <KpiTile label="Organisations" value={data.organizations} />
        <KpiTile label="Interactions" value={data.interactionsThisMonth} hint="Ce mois-ci" />
      </KpiGrid>
    </section>
  );
}
