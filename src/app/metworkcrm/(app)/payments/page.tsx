import type { Metadata } from 'next';
import { requireCrmAdmin } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { PaymentsList } from '@/components/metworkcrm/payments/payments-list';

export const metadata: Metadata = { title: 'Paiements' };
export const dynamic = 'force-dynamic';

/**
 * ADMIN-only (dev rules R-19, product spec §4.14). `requireCrmAdmin()` is the
 * real gate — the sidebar merely hides the link, which is not a guard. Every
 * `/api/metworkcrm/payments/**` route re-enforces this with
 * `requireCrmApiAdmin()` independently.
 */
export default async function CrmPaymentsPage() {
  await requireCrmAdmin();
  return (
    <>
      <CrmPageHeader title="Paiements" subtitle="Suivi opérationnel des encaissements." />
      <PaymentsList />
    </>
  );
}
