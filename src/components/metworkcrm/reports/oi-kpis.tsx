import type { OpenInnovationKpis } from '@/server/metworkcrm/services/reports';
import { OI_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';
import { BreakdownList } from './breakdown-list';

export function OpenInnovationKpisSection({ data }: { data: OpenInnovationKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Open Innovation</h2>
      <KpiGrid>
        <KpiTile label="Projets (total)" value={data.total} />
        <KpiTile label="Startups mobilisées" value={data.mobilizedStartups} />
        <KpiTile label="Experts mobilisés" value={data.mobilizedExperts} />
        <KpiTile
          label="Budget total"
          value={data.budgetTotal !== null ? `${data.budgetTotal.toLocaleString('fr-FR')} DZD` : null}
        />
      </KpiGrid>
      <BreakdownList
        title="Par étape"
        rows={data.byStage.map((r) => ({ label: OI_STAGE_LABELS[r.stage] ?? r.stage, value: r.n }))}
        emptyLabel="Aucun projet."
      />
    </section>
  );
}
