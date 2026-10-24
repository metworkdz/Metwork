import { setRequestLocale, getTranslations } from 'next-intl/server';
import { requireRole } from '@/lib/auth-guards';
import { CopilotChat } from '@/components/features/copilot/copilot-chat';
import { db } from '@/server/db/store';
import { quotaFor } from '@/server/copilot/service';
import { loadKb } from '@/server/copilot/kb-store';
import { guideProgressOf } from '@/server/copilot/guides';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('copilot');
  return { title: t('pageTitle') };
}

export default async function EntrepreneurCopilotPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('copilot');
  const session = await requireRole(['ENTREPRENEUR']);
  const data = await db.read();
  const user = data.users.find((u) => u.id === session.id);
  const kb = await loadKb().catch(() => null);
  const { q } = await searchParams;
  return (
    <CopilotChat
      initialQuota={user ? quotaFor(data, user) : { limit: 0, used: 0, remaining: 0 }}
      kbReady={Boolean(kb && kb.index.chunks.length > 0)}
      suggestions={[t('entrepreneur.s1'), t('entrepreneur.s2'), t('entrepreneur.s3'), t('entrepreneur.s4')]}
      membershipHref="/dashboard/entrepreneur/membership"
      initialQuestion={typeof q === 'string' ? q.slice(0, 1000) : undefined}
      initialGuideProgress={guideProgressOf(data, session.id)}
    />
  );
}
