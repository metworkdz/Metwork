import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ArrowLeft, CheckCircle2, Circle, Lock, PlayCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { getLearnView } from '@/server/academy/learn';
import { getPublicCourse } from '@/server/academy/catalog';
import { LessonPlayer } from '@/components/features/academy/lesson-player';
import { MarkCompleteButton } from '@/components/features/academy/mark-complete-button';
import { formatClock } from '@/components/features/academy/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ locale: string; slug: string; lessonId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  // Published courses only: a draft's title must not leak through the tab title.
  const course = await getPublicCourse(slug, locale);
  return { title: course?.title ?? 'Startup Academy', robots: { index: false } };
}

export default async function AcademyLessonPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, slug, lessonId } = await params;
  setRequestLocale(locale);
  const session = await readSession();
  if (!session) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/academy/learn/${slug}/${lessonId}`)}`);
  const view = await getLearnView(session.user, slug, locale);
  if (!view) notFound();
  const t = await getTranslations('academy');

  const flat = view.modules.flatMap((m, mi) => m.lessons.map((l, li) => ({ ...l, mi, li, moduleTitle: m.title })));
  const index = flat.findIndex((l) => l.id === lessonId);
  const lesson = flat[index];
  if (!lesson) notFound();
  const next = flat.slice(index + 1).find((l) => l.playable);
  const percent = view.playableCount ? Math.round((view.completedCount / view.playableCount) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link href={`/academy/courses/${slug}`} className="text-muted-foreground hover:text-foreground" aria-label={t('player.backToCourse')}><ArrowLeft className="size-5 rtl:rotate-180" /></Link>
        <p className="min-w-0 flex-1 truncate font-display font-extrabold">{view.title}</p>
        {view.access && (
          <div className="hidden items-center gap-3 text-sm text-muted-foreground sm:flex">
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"><span className="block h-full bg-primary" style={{ width: `${percent}%` }} /></span>
            {t('player.progress', { done: view.completedCount, total: view.playableCount })}
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {lesson.playable ? (
            <LessonPlayer courseId={view.course.id} lessonId={lesson.id} />
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center">
              <Lock className="size-10 text-muted-foreground" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">{t('player.locked')}</p>
              <Button asChild><Link href={`/academy/courses/${slug}`}>{t('player.unlock')}</Link></Button>
            </div>
          )}
          <div className="space-y-4 px-4 py-5 sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">{t('player.where', { module: lesson.mi + 1, lesson: lesson.li + 1 })}</p>
                <h1 className="mt-1 font-display text-2xl font-extrabold">{lesson.title}</h1>
              </div>
              <div className="flex gap-2">
                {lesson.playable && !lesson.completed && view.access && <MarkCompleteButton courseId={view.course.id} lessonId={lesson.id} />}
                {next && <Button asChild><Link href={`/academy/learn/${slug}/${next.id}`}>{t('player.next')}</Link></Button>}
              </div>
            </div>
          </div>
        </div>

        <aside className="border-border bg-card lg:min-h-[70vh] lg:border-s">
          <p className="px-4 pb-2 pt-4 font-display font-extrabold">{t('player.content')}</p>
          <nav aria-label={t('player.content')} className="pb-6">
            {view.modules.map((m, mi) => (
              <div key={m.id}>
                <p className="px-4 pb-1 pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t('course.module', { n: mi + 1 })} · {m.title}{m.comingSoon && <span className="ms-1 normal-case">({t('course.soon')})</span>}
                </p>
                <ul>
                  {m.lessons.map((l) => {
                    const current = l.id === lesson.id;
                    const Icon = l.completed ? CheckCircle2 : l.playable ? (current ? PlayCircle : Circle) : Lock;
                    const row = (
                      <span className={cn('flex items-start gap-3 px-4 py-2.5 text-sm', current && 'bg-primary/10 font-semibold', !l.playable && 'text-muted-foreground')}>
                        <Icon className={cn('mt-0.5 size-4 shrink-0', l.completed || current ? 'text-primary' : '')} aria-hidden />
                        <span className="min-w-0 flex-1">{l.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatClock(l.durationSec)}</span>
                      </span>
                    );
                    return (
                      <li key={l.id}>
                        {l.playable && !current
                          ? <Link href={`/academy/learn/${slug}/${l.id}`} className="block hover:bg-accent/60">{row}</Link>
                          : <span aria-current={current ? 'true' : undefined}>{row}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}
