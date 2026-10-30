import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { db } from '@/server/db/store';
import { academyRepo } from '@/server/academy/repo';
import { refundCheck } from '@/server/academy/orders';
import { resolveText } from '@/lib/localized-text';
import { CourseCover } from '@/components/features/academy/course-cover';
import { RefundButton } from '@/components/features/academy/refund-button';
import { formatDzd } from '@/components/features/academy/format';

export const dynamic = 'force-dynamic';

/** "My learning": every course this account owns, with progress and, while allowed, a refund. */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'academy.my' });
  return { title: t('title'), robots: { index: false } };
}

export default async function AcademyMyLearningPage({ params }: { params: Promise<{ locale: string }> }) {
  assertAcademyEnabled();
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/my`)}`);
  const t = await getTranslations('academy');
  const d = await db.read();
  const mine = (d.academyEnrollments ?? [])
    .filter((e) => e.userId === session.user.id && !e.revokedAt && !e.refundedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const rows = await Promise.all(mine.map(async (e) => {
    const course = d.academyCourses?.find((c) => c.id === e.courseId);
    if (!course) return null;
    const lessons = course.modules.filter((m) => !m.comingSoon).flatMap((m) => m.lessons);
    const progress = await academyRepo().progressFor(session.user.id, course.id);
    const done = progress.filter((p) => p.completedAt && lessons.some((l) => l.id === p.lessonId)).length;
    const refund = await refundCheck(session.user.id, e.id);
    return {
      e, course, title: resolveText(course.title, locale),
      percent: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
      done, total: lessons.length, refund,
    };
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">{t('my.title')}</h1>
      {rows.filter(Boolean).length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-display text-lg font-extrabold">{t('my.empty')}</p>
          <Button asChild className="mt-4"><Link href="/academy/courses">{t('my.browse')}</Link></Button>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {rows.map((r) => r && (
            <li key={r.e.id} className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-center">
              <CourseCover course={{ id: r.course.id, title: r.title, thumbnailUrl: r.course.thumbnailUrl }} />
              <div className="min-w-0">
                <p className="font-display text-lg font-extrabold leading-snug">{r.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t('my.lessonsDone', { done: r.done, total: r.total })}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${r.percent}%` }} /></div>
                {r.refund.eligible && (
                  <div className="mt-3">
                    <RefundButton
                      enrollmentId={r.e.id}
                      label={t('my.refund', { amount: t('money', { price: formatDzd(r.refund.amountDzd, locale) }) })}
                      until={new Date(r.refund.endsAt).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB', { day: 'numeric', month: 'long' })}
                    />
                  </div>
                )}
              </div>
              <Button asChild><Link href={`/academy/learn/${r.course.slug}`}>{r.done ? t('my.continue') : t('my.start')}</Link></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
