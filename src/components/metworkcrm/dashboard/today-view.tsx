import type { TodayViewData } from '@/server/metworkcrm/services/dashboard';
import { ListWidget } from './list-widget';

export function TodayView({ data }: { data: TodayViewData }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ListWidget
        title="Tâches du jour"
        items={data.tasks}
        emptyLabel="Aucune tâche à échéance aujourd'hui."
        seeAllHref="/metworkcrm/tasks"
      />
      <ListWidget
        title="Relances du jour"
        items={data.followUps}
        emptyLabel="Aucune relance à échéance aujourd'hui."
        seeAllHref="/metworkcrm/activities"
      />
    </div>
  );
}
