import { setRequestLocale, getTranslations } from 'next-intl/server';
import { MessageSquare } from 'lucide-react';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { requireRole } from '@/lib/auth-guards';
import { db } from '@/server/db/store';

interface PageProps {
  params: Promise<{ locale: string }>;
}

const STATUS_VARIANT = {
  PENDING:   'warning',
  CONNECTED: 'success',
  DECLINED:  'danger',
} as const;

const STATUS_LABEL = {
  PENDING:   'Pending',
  CONNECTED: 'Connected',
  DECLINED:  'Declined',
} as const;

export default async function InvestorMeetingsPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.dashboard');
  const user = await requireRole(['INVESTOR']);

  const data = await db.read();
  const contacts = (data.investorContacts ?? [])
    .filter((c) => c.investorId === user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title={t('investor.meetings.title')}
        subtitle={t('investor.meetings.subtitle')}
      />

      <Card>
        <CardContent className="p-0">
          {contacts.length === 0 ? (
            <InlineEmptyState
              title="No contact requests yet"
              description="Browse the startup marketplace and send a contact request to a founder."
              icon={<MessageSquare className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Startup</TableHead>
                    <TableHead>Founder</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Admin note</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.startupName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.founderName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status]}>
                          {STATUS_LABEL[c.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[24ch] truncate">
                        {c.adminNote ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
