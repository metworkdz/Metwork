import type { OpenInnovationViewData } from '@/server/metworkcrm/services/dashboard';
import { KpiGrid, KpiTile } from './kpi-tile';

export function OpenInnovationView({ data }: { data: OpenInnovationViewData }) {
  return (
    <KpiGrid>
      <KpiTile label="Entreprises intéressées" value={data.interestedCompanies} />
      <KpiTile label="Défis identifiés" value={data.challenges} />
      <KpiTile label="POC en cours" value={data.pocs} />
      <KpiTile label="Projets actifs" value={data.activeProjects} />
    </KpiGrid>
  );
}
