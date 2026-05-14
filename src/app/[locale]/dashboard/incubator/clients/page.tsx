import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { ClientsManager } from '@/components/features/incubator/clients-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ClientsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.incubator.clients');
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ClientsManager />
    </div>
  );
}
