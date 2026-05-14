'use client';

/**
 * Members table — displays entrepreneurs enrolled in any of the incubator's programs.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Users, Search, Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { StatCard } from '@/components/shared/stat-card';

interface Member {
  userId: string;
  name: string;
  email: string;
  phone: string;
  programName: string;
  enrolledAt: string;
  bookingId: string;
}

interface Props {
  initial: Member[];
}

export function MembersTable({ initial }: Props) {
  const t = useTranslations('incubator.membersTable');
  const [q, setQ] = useState('');

  const filtered = q.trim()
    ? initial.filter(
        (m) =>
          m.name.toLowerCase().includes(q.toLowerCase()) ||
          m.email.toLowerCase().includes(q.toLowerCase()) ||
          m.programName.toLowerCase().includes(q.toLowerCase()),
      )
    : initial;

  // Unique programs
  const programs = [...new Set(initial.map((m) => m.programName))];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statTotalMembers')} value={initial.length} icon={Users} />
        <StatCard label={t('statPrograms')} value={programs.length} icon={Briefcase} />
        <StatCard
          label={t('statMostRecent')}
          value={
            initial.length > 0
              ? new Date(
                  Math.max(...initial.map((m) => new Date(m.enrolledAt).getTime())),
                ).toLocaleDateString()
              : '—'
          }
          icon={Users}
        />
      </div>

      <Card>
        <div className="border-b border-border/60 px-5 py-3">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="ps-9"
              placeholder={t('searchPlaceholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <InlineEmptyState
              title={q ? t('noMatches') : t('emptyTitle')}
              description={q ? t('tryDifferentSearch') : t('emptyDescription')}
              icon={<Users className="size-5 text-muted-foreground" />}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colMember')}</TableHead>
                    <TableHead>{t('colPhone')}</TableHead>
                    <TableHead>{t('colProgram')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('colEnrolled')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((m) => (
                    <TableRow key={m.bookingId}>
                      <TableCell>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.phone}</TableCell>
                      <TableCell>
                        <Badge variant="info" className="whitespace-nowrap">{m.programName}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {new Date(m.enrolledAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
