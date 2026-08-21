import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireCrmUser } from '@/server/metworkcrm/auth/guards';
import { getOrganizationDetail } from '@/server/metworkcrm/services/organizations';
import { CrmNotFoundError } from '@/server/metworkcrm/services/errors';
import { OrganizationDetail } from '@/components/metworkcrm/organizations/organization-detail';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  try {
    const { organization } = await getOrganizationDetail(id);
    return { title: organization.name };
  } catch {
    return { title: 'Organisation' };
  }
}

/**
 * The "Entreprise ABC" page from the product spec: everything linked to this
 * organization — contacts, timeline, tasks, opportunities — visible on one
 * page, no digging. Fetched server-side directly through the service (no HTTP
 * round-trip); client-side mutations refetch through the API route.
 */
export default async function CrmOrganizationDetailPage({ params }: Params) {
  const user = await requireCrmUser();
  const { id } = await params;

  try {
    const detail = await getOrganizationDetail(id, user);
    return <OrganizationDetail initial={detail} />;
  } catch (err) {
    if (err instanceof CrmNotFoundError) notFound();
    throw err;
  }
}
