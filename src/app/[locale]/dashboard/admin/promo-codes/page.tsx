import { setRequestLocale, getTranslations } from 'next-intl/server';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { listPromoCodes } from '@/server/promo-codes/service';
import { db } from '@/server/db/store';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CreatePromoCodeForm } from '@/components/features/admin/create-promo-code-form';
import { PromoCodeToggle } from '@/components/features/admin/promo-code-toggle';
import { PromoCodeEditButton } from '@/components/features/admin/promo-code-edit-button';
import { PromoCodeDeleteButton } from '@/components/features/admin/promo-code-delete-button';
import type { PromoCodeRecord } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

function statusBadge(p: PromoCodeRecord) {
  if (!p.isActive) return <Badge variant="default">Inactive</Badge>;
  if (p.expiresAt && new Date(p.expiresAt) <= new Date())
    return <Badge variant="danger">Expired</Badge>;
  if (p.usageLimit !== null && p.usedCount >= p.usageLimit)
    return <Badge variant="danger">Limit reached</Badge>;
  return <Badge variant="success">Active</Badge>;
}

export default async function AdminPromoCodesPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const codes = await listPromoCodes();
  const tc = await getTranslations('admin.promoCodes');
  const incubatorName = new Map((await db.read()).incubators.map((i) => [i.id, i.name]));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.promoCodes.title')}
        subtitle={t('admin.promoCodes.subtitle')}
      />

      {/* Create form */}
      <Card>
        <CardContent className="p-6">
          <h2 className="mb-4 text-sm font-semibold">Create a new promo code</h2>
          <CreatePromoCodeForm />
        </CardContent>
      </Card>

      {/* Codes table */}
      <Card>
        <CardContent className="p-0">
          {codes.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No promo codes yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">{tc('colOwner')}</th>
                    <th className="px-4 py-3">Discount</th>
                    <th className="px-4 py-3">Applies to</th>
                    <th className="px-4 py-3">Usage</th>
                    <th className="px-4 py-3">Expires</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={code.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-3 font-mono font-semibold tracking-wide">{code.code}</td>
                      <td className="px-4 py-3">
                        {code.ownerIncubatorId
                          ? <Badge variant="info">{incubatorName.get(code.ownerIncubatorId) ?? tc('ownerUnknown')}</Badge>
                          : <span className="text-muted-foreground">{tc('ownerPlatform')}</span>}
                      </td>
                      <td className="px-4 py-3">{code.discountPercent}%</td>
                      <td className="px-4 py-3 capitalize">
                        {code.scope
                          ? tc('scopeSummary', { programs: code.scope.programIds.length, spaces: code.scope.spaceIds.length })
                          : code.appliesTo.toLowerCase()}
                      </td>
                      <td className="px-4 py-3">
                        {code.usedCount}
                        {code.usageLimit !== null ? ` / ${code.usageLimit}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        {code.expiresAt
                          ? new Date(code.expiresAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-4 py-3">{statusBadge(code)}</td>
                      <td className="px-4 py-3 text-end">
                        <div className="flex justify-end gap-2">
                          <PromoCodeEditButton promo={code} owned={!!code.ownerIncubatorId} />
                          <PromoCodeToggle id={code.id} isActive={code.isActive} />
                          <PromoCodeDeleteButton id={code.id} code={code.code} usedCount={code.usedCount ?? 0} />
                        </div>
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
