/**
 * /dashboard/incubator/events/[id]
 *
 * Event detail management page for incubators.
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

export default async function IncubatorEventDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const user = await requireRole(['INCUBATOR']);
  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  if (!incubator) notFound();

  const event = (data.events ?? []).find((e) => e.id === id && e.incubatorId === incubator.id);
  if (!event) notFound();

  const formFields = await listFormFields('EVENT', id);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={event.title}
        subtitle={event.city}
      />
      <ProgramRegistrationDashboard
        entityType="EVENT"
        entityId={id}
        entityTitle={event.title}
        entitySlug={event.slug ?? null}
        initialFormFields={formFields}
      />
    </div>
  );
}
