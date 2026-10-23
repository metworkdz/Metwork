import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { Link } from '@/i18n/routing';
import { MatchWorkspace } from '@/components/features/cofounder/match-workspace';
import { db } from '@/server/db/store';
import { cofounderRepo } from '@/server/cofounder/repo';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

// Generic title: metadata resolves before the page's access check.
export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cofounder');
  return { title: t('pageTitle') };
}

export default async function FreelancerMatchPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('cofounder');
  const session = await requireRole(['FREELANCER']);
  const match = await cofounderRepo().getMatch(id).catch(() => null);
  if (!match || (match.userA !== session.id && match.userB !== session.id)) notFound();
  const otherId = match.userA === session.id ? match.userB : match.userA;
  const other = (await db.read()).users.find((u) => u.id === otherId);
  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/dashboard/freelancer/cofounder" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t('backToMatches')}
      </Link>
      <h1 className="text-xl font-semibold"><bdi>{other?.fullName ?? '—'}</bdi></h1>
      <MatchWorkspace matchId={id} me={session.id} other={{ id: otherId, name: other?.fullName ?? '—' }} />
    </div>
  );
}
