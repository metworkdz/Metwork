import type { CommercialViewData } from '@/server/metworkcrm/services/dashboard';
import { KpiGrid, KpiTile } from './kpi-tile';

export function CommercialView({ data }: { data: CommercialViewData }) {
  return (
    <KpiGrid>
      <KpiTile label="Nouveaux leads" value={data.newLeads} />
      <KpiTile label="Propositions envoyées" value={data.offers} />
      <KpiTile label="En négociation" value={data.negotiations} />
      <KpiTile label="Affaires gagnées" value={data.wonDeals} />
      <KpiTile
        label="Valeur du pipeline"
        value={data.pipelineValue !== null ? `${data.pipelineValue.toLocaleString('fr-FR')} DZD` : null}
      />
    </KpiGrid>
  );
}
