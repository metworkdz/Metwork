import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, Lock } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { getLearnView } from '@/server/academy/learn';
import { getLearnerQuiz } from '@/server/academy/quiz';
import { QuizForm } from '@/components/features/academy/quiz-form';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ locale: string; slug: string; moduleId: string }> }

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Quiz · Startup Academy', robots: { index: false } };
}

export default async function AcademyQuizPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, slug, moduleId } = await params;
  setRequestLocale(locale);
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/learn/${slug}/quiz/${moduleId}`)}`);
  const view = await getLearnView(session.user, slug, locale);
  if (!view) notFound();
  const t = await getTranslations('academy');
  const res = await getLearnerQuiz(session.user, view.course.id, moduleId, locale);
  if (!res.ok && res.code !== 'LOCKED') notFound();
  const moduleIndex = view.modules.findIndex((m) => m.id === moduleId);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link href={`/academy/learn/${slug}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />{view.title}
      </Link>
      <p className="mt-4 text-xs font-bold uppercase tracking-wider text-primary">{t('learning.quiz.eyebrow', { n: moduleIndex + 1 })}</p>
      {res.ok ? (
        <>
          <h1 className="mt-1 font-display text-2xl font-extrabold">{res.quiz.moduleTitle}</h1>
          <div className="mt-5">
            <QuizForm courseId={view.course.id} moduleId={moduleId} questions={res.quiz.questions} passScore={res.quiz.passScore} initial={res.quiz.result} backHref={`/academy/learn/${slug}`} />
          </div>
        </>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-muted p-8 text-center">
          <Lock className="size-8 text-muted-foreground" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">{t('learning.quiz.locked')}</p>
          <Button asChild><Link href={`/academy/courses/${slug}`}>{t('player.unlock')}</Link></Button>
        </div>
      )}
    </div>
  );
}
