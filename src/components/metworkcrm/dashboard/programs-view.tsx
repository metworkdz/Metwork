import type { ProgramsViewData } from '@/server/metworkcrm/services/dashboard';
import { PROGRAM_TYPE_LABELS } from '@/components/metworkcrm/shared/labels';
import { KpiGrid, KpiTile } from './kpi-tile';
import { ListWidget } from './list-widget';

export function ProgramsView({ data }: { data: ProgramsViewData }) {
  const upcoming = data.upcoming.map((item) => ({
    ...item,
    subtitle: item.subtitle ? (PROGRAM_TYPE_LABELS[item.subtitle] ?? item.subtitle) : item.subtitle,
  }));

  return (
    <div className="space-y-4">
      <KpiGrid>
        <KpiTile label="Inscriptions récentes" value={data.recentRegistrations} hint="7 derniers jours" />
      </KpiGrid>
      <ListWidget
        title="Prochains programmes & événements"
        items={upcoming}
        emptyLabel="Aucun programme ou événement à venir."
        seeAllHref="/metworkcrm/programs"
      />
    </div>
  );
}
