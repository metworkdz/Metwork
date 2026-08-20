import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { TasksList } from '@/components/metworkcrm/tasks/tasks-list';

export const metadata: Metadata = { title: 'Tâches' };
export const dynamic = 'force-dynamic';

export default async function CrmTasksPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Tâches" subtitle="Suivi des actions à mener." />
      <TasksList />
    </>
  );
}
