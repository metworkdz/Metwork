import type { ProgramsKpis } from '@/server/metworkcrm/services/reports';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';

export function ProgramsKpisSection({ data }: { data: ProgramsKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Programmes</h2>
      <KpiGrid>
        <KpiTile
          label="Taux de remplissage"
          value={data.fillRate !== null ? `${Math.round(data.fillRate * 100)}%` : null}
          hint="Programmes avec capacité définie"
        />
        <KpiTile
          label="Taux de présence"
          value={data.attendanceRate !== null ? `${Math.round(data.attendanceRate * 100)}%` : null}
        />
        <KpiTile
          label="Chiffre d'affaires"
          value={data.revenue !== null ? `${data.revenue.toLocaleString('fr-FR')} DZD` : null}
        />
        <KpiTile
          label="Satisfaction moyenne"
          value={data.avgSatisfaction !== null ? `${data.avgSatisfaction} / 5` : null}
        />
      </KpiGrid>
    </section>
  );
}
