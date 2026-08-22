import type { OperationsKpis } from '@/server/metworkcrm/services/reports';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';

export function OperationsKpisSection({ data }: { data: OperationsKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Opérations</h2>
      <KpiGrid>
        <KpiTile label="Tâches terminées" value={data.tasksDoneThisMonth} hint="Ce mois-ci" />
        <KpiTile label="Tâches en retard" value={data.tasksOverdue} />
        <KpiTile
          label="Délai de traitement"
          value={data.avgProcessingDays !== null ? `${data.avgProcessingDays} j` : null}
          hint="Moyenne, tâches terminées ce mois-ci"
        />
      </KpiGrid>
    </section>
  );
}
