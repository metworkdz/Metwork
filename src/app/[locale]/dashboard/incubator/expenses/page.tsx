import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { ExpensesManager } from '@/components/features/incubator/expenses-manager';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ExpensesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard.incubator.expenses');
  await requireRole(['INCUBATOR']);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <ExpensesManager />
    </div>
  );
}
