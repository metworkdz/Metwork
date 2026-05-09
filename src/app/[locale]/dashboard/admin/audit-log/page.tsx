import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ShieldAlert } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { requireRole } from '@/lib/auth-guards';
import { listAuditLogs } from '@/server/audit/service';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { AuditLogRecord } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Colour-code each action category. */
function actionBadge(action: AuditLogRecord['action']) {
  const danger = new Set<AuditLogRecord['action']>([
    'USER_BANNED',
    'USER_DELETED',
    'INCUBATOR_DELETED',
  ]);
  const warning = new Set<AuditLogRecord['action']>([
    'USER_SUSPENDED',
    'USER_ROLE_CHANGED',
    'MEMBERSHIP_CHANGED',
  ]);
  const success = new Set<AuditLogRecord['action']>([
    'USER_REINSTATED',
    'INCUBATOR_CREATED',
    'PROMO_CODE_CREATED',
  ]);

  let variant: 'danger' | 'warning' | 'success' | 'default' = 'default';
  if (danger.has(action)) variant = 'danger';
  else if (warning.has(action)) variant = 'warning';
  else if (success.has(action)) variant = 'success';

  const label = action.replace(/_/g, ' ');
  return <Badge variant={variant}>{label}</Badge>;
}

/** Render the details map as a compact key=value string. */
function renderDetails(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('  ·  ');
}

export default async function AdminAuditLogPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  await requireRole(['ADMIN']);

  const logs = await listAuditLogs(200);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('admin.auditLog.title')}
        subtitle={t('admin.auditLog.subtitle')}
      />

      <Card>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
              <ShieldAlert className="size-8 opacity-30" />
              <p>No admin actions recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Admin</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20"
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString('en-GB', {
                          dateStyle: 'short',
                          timeStyle: 'medium',
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">{log.adminEmail}</span>
                      </td>
                      <td className="px-4 py-3">{actionBadge(log.action)}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium capitalize">{log.targetType}</span>
                        <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                          {log.targetId.slice(0, 8)}…
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-xs text-muted-foreground">
                        {renderDetails(log.details)}
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
