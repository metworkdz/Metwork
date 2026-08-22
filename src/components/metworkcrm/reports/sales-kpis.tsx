import type { SalesKpis } from '@/server/metworkcrm/services/reports';
import { OPPORTUNITY_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { KpiGrid, KpiTile } from '@/components/metworkcrm/dashboard/kpi-tile';
import { BreakdownList } from './breakdown-list';

export function SalesKpisSection({ data }: { data: SalesKpis }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--crm-black)]">Ventes</h2>
      <KpiGrid>
        <KpiTile label="Leads (total)" value={data.leads} />
        <KpiTile
          label="Taux de conversion"
          value={data.conversionRate !== null ? `${Math.round(data.conversionRate * 100)}%` : null}
          hint="Gagné / (Gagné + Perdu)"
        />
        <KpiTile
          label="Pipeline ouvert"
          value={data.pipelineValue !== null ? `${data.pipelineValue.toLocaleString('fr-FR')} DZD` : null}
        />
        <KpiTile label="Affaires gagnées" value={data.won} />
      </KpiGrid>
      {data.revenueByType ? (
        <BreakdownList
          title="Chiffre d'affaires par service (affaires gagnées)"
          rows={data.revenueByType.map((r) => ({
            label: OPPORTUNITY_TYPE_LABELS[r.type] ?? r.type,
            value: `${r.total.toLocaleString('fr-FR')} DZD`,
          }))}
          emptyLabel="Aucune affaire gagnée pour le moment."
        />
      ) : null}
    </section>
  );
}
