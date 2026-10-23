import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProjectsBoard } from '@/components/features/freelancer/projects-board';
import { db } from '@/server/db/store';
import { listProjects } from '@/server/freelancers/workspace';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function FreelancerProjectsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancer.projects');
  const user = await requireRole(['FREELANCER']);
  const projects = listProjects(await db.read(), user.id).map(({ id, title, clientName, status, dueDate, amount }) => ({
    id, title, clientName, status, dueDate, amount,
  }));
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('pageTitle')} subtitle={t('subtitle')} />
      <ProjectsBoard initial={projects} />
    </div>
  );
}
