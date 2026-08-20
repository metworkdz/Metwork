import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getContactDetail } from '@/server/metworkcrm/services/contacts';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { ContactDetail } from '@/components/metworkcrm/contacts/contact-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { contact } = await getContactDetail(id);
    return { title: contact.fullName ?? `${contact.firstName} ${contact.lastName}` };
  } catch {
    return { title: 'Contact' };
  }
}

/** Same "everything visible" timeline pattern as the Organization detail page. */
export default async function CrmContactDetailPage({ params }: Params) {
  await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getContactDetail(id);
    return <ContactDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
