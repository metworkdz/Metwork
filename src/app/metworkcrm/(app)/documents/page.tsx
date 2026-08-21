import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { DocumentsList } from '@/components/metworkcrm/documents/documents-list';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

export default async function CrmDocumentsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Documents" subtitle="Conventions, contrats, propositions et supports." />
      <DocumentsList />
    </>
  );
}
