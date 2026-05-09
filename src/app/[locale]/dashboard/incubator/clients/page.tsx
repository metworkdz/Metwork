import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { ClientsManager } from '@/components/features/incubator/clients-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ClientsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clients</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your client directory — search, add, and update client profiles.
        </p>
      </div>
      <ClientsManager />
    </div>
  );
}
