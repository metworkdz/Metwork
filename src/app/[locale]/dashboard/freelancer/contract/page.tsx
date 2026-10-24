import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { ContractSigning } from '@/components/features/freelancer/contract-signing';
import { db } from '@/server/db/store';
import { contractView, currentContract, offerContractIfEligible, profilePercent } from '@/server/freelancer-contracts/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancerContract');
  return { title: t('title') };
}

/** The freelancer's contract with Metwork. */
export default async function FreelancerContractPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('freelancerContract');
  const session = await requireRole(['FREELANCER']);
  // Not left to the layout: Next renders layout and page in parallel, so the
  // page could read before the layout's offer lands and show "locked" at 100 %.
  await offerContractIfEligible(session.id).catch(() => false);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id);
  const c = currentContract(data, session.id);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <ContractSigning
        initial={c ? contractView(c) : null}
        profilePercent={user ? profilePercent(data, user) : 0}
      />
    </div>
  );
}
