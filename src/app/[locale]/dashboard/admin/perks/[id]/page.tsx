import { setRequestLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { requireRole } from '@/lib/auth-guards';
import { listPerks, listPoolEntries } from '@/server/perks/service';
import { PerkCodesForm } from '@/components/features/admin/perk-codes-form';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export default async function AdminPerkCodesPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.perks');
  await requireRole(['ADMIN']);

  const [perks, entries] = await Promise.all([listPerks(), listPoolEntries(id)]);
  const perk = perks.find((p) => p.id === id);
  if (!perk || !entries || perk.fulfillmentType !== 'CODE_POOL') notFound();

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={`${perk.partnerName} — ${perk.title}`}
        subtitle={t('codesSubtitle', {
          available: perk.stockAvailable ?? 0,
          assigned: perk.codesAssigned ?? 0,
        })}
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/admin/perks">
              <ArrowLeft className="me-1.5 size-4 rtl:rotate-180" />
              {t('backToPerks')}
            </Link>
          </Button>
        }
      />

      {/* Add more codes */}
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-sm font-semibold">{t('addCodes')}</h2>
          <PerkCodesForm perkId={perk.id} />
        </CardContent>
      </Card>

      {/* Pool table */}
      <Card>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('noCodes')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 text-start">{t('colCode')}</th>
                    <th className="px-4 py-3 text-start">{t('colStatus')}</th>
                    <th className="px-4 py-3 text-start">{t('colAssignedTo')}</th>
                    <th className="px-4 py-3 text-start">{t('colAssignedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-mono font-semibold tracking-wide">
                        {entry.code}
                      </td>
                      <td className="px-4 py-3">
                        {entry.status === 'AVAILABLE' ? (
                          <Badge variant="success">{t('statusAvailable')}</Badge>
                        ) : (
                          <Badge variant="default">{t('statusAssigned')}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {entry.assignedToName ? (
                          <div className="min-w-0">
                            <p className="truncate font-medium">{entry.assignedToName}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {entry.assignedToEmail}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {entry.assignedAt ? new Date(entry.assignedAt).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
