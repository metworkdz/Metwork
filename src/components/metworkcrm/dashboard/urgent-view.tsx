import type { UrgentViewData } from '@/server/metworkcrm/services/dashboard';
import { ListWidget } from './list-widget';
import { KpiGrid, KpiTile } from './kpi-tile';

export function UrgentView({ data }: { data: UrgentViewData }) {
  return (
    <div className="space-y-4">
      {data.overduePaymentsCount !== null ? (
        <KpiGrid>
          <KpiTile label="Paiements en retard" value={data.overduePaymentsCount} hint="Module Paiements — ADMIN" />
        </KpiGrid>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <ListWidget
          title="Tâches en retard"
          items={data.overdueTasks}
          emptyLabel="Aucune tâche en retard."
          seeAllHref="/metworkcrm/tasks"
        />
        <ListWidget
          title="Prospects non relancés"
          items={data.unfollowedProspects}
          emptyLabel="Aucun prospect en attente de relance."
          seeAllHref="/metworkcrm/activities"
        />
        <ListWidget
          title="Opportunités bloquées"
          items={data.blockedOpportunities}
          emptyLabel="Aucune opportunité bloquée (7 jours et plus sans changement)."
          seeAllHref="/metworkcrm/sales"
        />
      </div>
    </div>
  );
}
