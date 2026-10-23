import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { VentureForm, type VentureFormValues } from '@/components/features/ventures/venture-form';
import { db } from '@/server/db/store';
import { draftFromListing, ventureOf } from '@/server/ventures/service';
import { entitlementsForUser } from '@/lib/entitlements';
import { defaultLegalStatusFor } from '@/lib/venture-options';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function EntrepreneurVenturePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('venture');
  const user = await requireRole(['ENTREPRENEUR']);
  const data = await db.read();
  const venture = ventureOf(data, user.id);
  const draft = venture ? null : draftFromListing(data, user.id);
  const record = data.users.find((u) => u.id === user.id) ?? user;
  const ent = entitlementsForUser(record);
  const canPublish = ent?.audience === 'ENTREPRENEUR' && ent.publicStartupPage;
  const kind = venture?.kind ?? draft?.kind ?? 'STARTUP';

  const initial: VentureFormValues = venture
    ? {
        name: venture.name,
        kind: venture.kind,
        legal: venture.legal,
        stage: venture.stage,
        sector: venture.sector,
        wilaya: venture.wilaya,
        description: venture.description,
        website: venture.website,
        lookingFor: venture.lookingFor,
        isPublic: venture.isPublic,
      }
    : {
        name: draft?.name ?? '',
        kind,
        legal: { status: defaultLegalStatusFor(kind) },
        stage: 'IDEA',
        sector: draft?.sector ?? '',
        wilaya: user.city ?? '',
        description: draft?.description ?? '',
        website: draft?.website ?? null,
        lookingFor: [],
        isPublic: false,
      };

  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={venture ? t('subtitleEdit') : t('subtitleCreate')} />
      <VentureForm initial={initial} exists={!!venture} slug={venture?.slug ?? null} canPublish={canPublish} />
    </div>
  );
}
