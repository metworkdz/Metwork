import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProgramsManager } from '@/components/features/incubator/programs-manager';
import { requireRole } from '@/lib/auth-guards';
import { demoIncubatorPrograms } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorProgramsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Programs"
        subtitle="Incubation, acceleration, training, and workshops."
      />
      <ProgramsManager initial={demoIncubatorPrograms} />
    </div>
  );
}
