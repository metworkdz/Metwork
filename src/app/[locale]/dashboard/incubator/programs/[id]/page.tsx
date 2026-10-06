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
import { resolveListingPricing } from '@/lib/listing-price';
import { listIncubatorPromoCodes } from '@/server/promo-codes/incubator-service';
import { toScopedPromoCode } from '@/lib/promo-code-ui';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  /** `?tab=feedback` opens a tab directly — the « Avis » page links here. */
  searchParams: Promise<{ tab?: string }>;
}

export default async function IncubatorProgramDetailPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params;
  const { tab } = await searchParams;
  setRequestLocale(locale);

  const user = await requireRole(['INCUBATOR']);
  const data = await db.read();
  const incubator = data.incubators.find((i) => i.managerId === user.id);
  if (!incubator) notFound();

  const program = (data.programs ?? []).find((p) => p.id === id && p.incubatorId === incubator.id);
  if (!program) notFound();

  const formFields = await listFormFields('PROGRAM', id);

  // Feeds the « Promo codes » tab: the incubator's own codes plus the listings a code can be ticked for.
  const promoData = {
    codes: (await listIncubatorPromoCodes(incubator.id)).map(toScopedPromoCode),
    programs: (data.programs ?? [])
      .filter((p) => p.incubatorId === incubator.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({ id: p.id, title: p.title, city: p.city })),
    spaces: (data.spaces ?? [])
      .filter((s) => s.incubatorId === incubator.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({ id: s.id, name: s.name, city: s.city })),
  };

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={program.title}
        subtitle={`${program.city} · ${program.type}`}
      />
      <ProgramRegistrationDashboard
        initialTab={tab === 'feedback' ? 'feedback' : undefined}
        entityType="PROGRAM"
        entityId={id}
        entityTitle={program.title}
        entitySlug={program.slug ?? null}
        initialFormFields={formFields}
        defaultAmount={resolveListingPricing(program.price, program).cash}
        promoData={promoData}
      />
    </div>
  );
}
