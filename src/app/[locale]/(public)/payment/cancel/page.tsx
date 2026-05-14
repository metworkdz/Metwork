import { XCircle } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function PaymentCancelPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.payment.cancel');

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-16">
      <Card className="w-full max-w-md border-border/60 shadow-lg">
        <CardContent className="p-8 text-center">
          <div className="flex justify-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <XCircle className="size-7 text-muted-foreground" />
            </div>
          </div>

          <h1 className="mt-5 text-xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('description')}
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <Button asChild className="w-full">
              <Link href="/dashboard/entrepreneur/wallet">{t('tryAgain')}</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full text-muted-foreground">
              <Link href="/">{t('backHome')}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
