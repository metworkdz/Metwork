import type { EcosystemViewData } from '@/server/metworkcrm/services/dashboard';
import { KpiGrid, KpiTile } from './kpi-tile';

export function EcosystemView({ data }: { data: EcosystemViewData }) {
  return (
    <KpiGrid>
      <KpiTile label="Nouveaux partenaires" value={data.newPartners} hint="30 derniers jours" />
      <KpiTile label="Partenariats actifs" value={data.activePartnerships} />
      <KpiTile label="Startups" value={data.startups} />
      <KpiTile label="Experts" value={data.experts} />
    </KpiGrid>
  );
}
