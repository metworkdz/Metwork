import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { ServicesManager } from '@/components/features/incubator/services-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ServicesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your service catalog — used when recording income and generating reports.
        </p>
      </div>
      <ServicesManager />
    </div>
  );
}
