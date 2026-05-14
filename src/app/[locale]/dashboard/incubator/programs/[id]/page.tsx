/**
 * /dashboard/incubator/programs/[id]
 *
 * Program detail management page for incubators.
 * Shows two tabs: Registration Form Builder + Registrations list.
 */
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';
import { listFormFields } from '@/server/registrations/service';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ProgramRegistrationDashboard } from '@/components/features/registrations/program-registration-dashboard';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function IncubatorProgramDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requireRole(['INCUBATOR']);
  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  if (!incubator) notFound();

  const program = (data.programs ?? []).find((p) => p.id === id && p.incubatorId === incubator.id);
  if (!program) notFound();

  const formFields = await listFormFields('PROGRAM', id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={program.title}
        subtitle={`${program.city} · ${program.type}`}
      />
      <ProgramRegistrationDashboard
        entityType="PROGRAM"
        entityId={id}
        entityTitle={program.title}
        entitySlug={program.slug ?? null}
        initialFormFields={formFields}
      />
    </div>
  );
}
