import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { IncomeManager } from '@/components/features/incubator/income-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function IncomePage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Income</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Record revenue from all sources — manual entries or bulk CSV import.
        </p>
      </div>
      <IncomeManager />
    </div>
  );
}
