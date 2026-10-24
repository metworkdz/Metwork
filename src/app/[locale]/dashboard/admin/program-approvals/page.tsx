/**
 * Programmes à valider — every program a consultant submits waits here until
 * an admin approves it (then it appears on /programs) or refuses it with a
 * reason the consultant sees.
 */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ClipboardCheck } from 'lucide-react';

import { requireRole } from '@/lib/auth-guards';
import { DashboardPageHeader } from '@/components/shared/dashboard-page-header';
import { StatCard } from '@/components/shared/stat-card';
import { ProgramApprovalsManager, type ProgramReviewView } from '@/components/features/admin/program-approvals-manager';
import { programDates } from '@/lib/program-dates';
import { db } from '@/server/db/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Programmes à valider' };

export default async function AdminProgramApprovalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('admin.programApprovals');
  await requireRole(['ADMIN']);

  const data = await db.read();
  const mentors = new Map((data.mentors ?? []).map((m) => [m.id, m]));
  const items: ProgramReviewView[] = (data.programs ?? [])
    // Reviewed programs only: older consultant programs have no status and
    // follow the old rule, so they are not a decision anyone is waiting on.
    .filter((p) => p.mentorId && p.reviewStatus)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p) => {
      const dates = programDates(p);
      return {
        id: p.id,
        title: p.title,
        description: p.description ?? '',
        imageUrl: p.imageUrl ?? null,
        consultant: mentors.get(p.mentorId!)?.fullName ?? p.mentorName ?? '',
        consultantEmail: mentors.get(p.mentorId!)?.email ?? null,
        city: p.city ?? '',
        type: p.type,
        price: p.price ?? 0,
        seatsTotal: p.seatsTotal ?? 0,
        startDate: dates?.startDate ?? null,
        endDate: dates?.endDate ?? null,
        visibility: p.visibility === 'UNLISTED' ? 'UNLISTED' : 'PUBLIC',
        status: p.reviewStatus!,
        rejectionReason: p.reviewRejectionReason ?? null,
        createdAt: p.createdAt,
      };
    });

  const count = (s: ProgramReviewView['status']) => items.filter((i) => i.status === s).length;
  return (
    <div className="space-y-6">
      <DashboardPageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t('statPending')} value={count('PENDING')} icon={ClipboardCheck} />
        <StatCard label={t('statApproved')} value={count('APPROVED')} />
        <StatCard label={t('statRejected')} value={count('REJECTED')} />
      </div>
      <ProgramApprovalsManager initial={items} />
    </div>
  );
}
