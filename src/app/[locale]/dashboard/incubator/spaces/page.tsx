import { setRequestLocale } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { SpacesManager } from '@/components/features/incubator/spaces-manager';
import { requireRole } from '@/lib/auth-guards';
import { demoIncubatorSpaces } from '@/lib/demo-data';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncubatorSpacesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Spaces"
        subtitle="Coworking floors, private offices, training rooms, and domiciliation."
      />
      <SpacesManager initial={demoIncubatorSpaces} />
    </div>
  );
}
