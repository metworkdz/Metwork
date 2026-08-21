import type { StartupsKpis } from '@/server/metworkcrm/services/reports';
import { STARTUP_STAGE_LABELS } from '@/components/metworkcrm/shared/labels';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';
import { BreakdownList } from './breakdown-list';

export function StartupsKpisSection({ data }: { data: StartupsKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Startups</h2>
      <KpiGrid>
        <KpiTile label="Startups (total)" value={data.total} />
        <KpiTile label="Rattachées à un programme" value={data.withProgram} />
      </KpiGrid>
      <div className="grid gap-3 sm:grid-cols-2">
        <BreakdownList
          title="Par secteur"
          rows={data.bySector.map((r) => ({ label: r.sector, value: r.n }))}
          emptyLabel="Aucune startup."
        />
        <BreakdownList
          title="Progression (étapes du pipeline)"
          rows={data.byStage.map((r) => ({ label: STARTUP_STAGE_LABELS[r.stage] ?? r.stage, value: r.n }))}
          emptyLabel="Aucune startup."
        />
      </div>
    </section>
  );
}
