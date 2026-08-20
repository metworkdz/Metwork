import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { CrmPageHeader } from '@/components/metworkcrm/shared/page-header';
import { ContactsList } from '@/components/metworkcrm/contacts/contacts-list';

export const metadata: Metadata = { title: 'Contacts' };
export const dynamic = 'force-dynamic';

export default async function CrmContactsPage() {
  await requireCrmUser();
  return (
    <>
      <CrmPageHeader title="Contacts" subtitle="Personnes rattachées aux organisations." />
      <ContactsList />
    </>
  );
}
