import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import type { PublicCourseCard } from '@/server/academy/catalog';
import { CourseCover } from './course-cover';
import { formatDuration, formatDzd } from './format';
import { Stars } from './stars';

/** One course in a grid. Server component: translations resolved at render. */
export async function CourseCard({ course, locale, fieldLabel }: { course: PublicCourseCard; locale: string; fieldLabel: string }) {
  const t = await getTranslations('academy');
  const lead = course.mentors[0];
  return (
    <Link href={`/academy/courses/${course.slug}`} className="group flex min-w-0 flex-col gap-2 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CourseCover course={course} fieldLabel={fieldLabel} badge={course.includedInPass ? t('card.inPass') : null} duration={formatDuration(course.durationSec, t)} />
      <h3 className="line-clamp-2 font-display text-[15px] font-bold leading-snug text-foreground group-hover:text-primary">{course.title}</h3>
      {lead && <p className="truncate text-xs text-muted-foreground">{course.mentors.map((m) => m.fullName).join(', ')}</p>}
      {course.rating.count > 0 && course.rating.average !== null && (
        <p className="flex items-center gap-1.5 text-xs">
          <span className="font-bold text-amber-600 dark:text-amber-400">{course.rating.average}</span>
          <Stars value={course.rating.average} className="[&_svg]:size-3.5" label={t('learning.reviews.average', { average: course.rating.average })} />
          <span className="text-muted-foreground">({course.rating.count})</span>
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t(`levels.${course.level}`)} · {t('card.lessons', { count: course.lessonCount })}
        {course.comingSoonModules > 0 && <> · <span className="text-primary">{t('card.moreSoon')}</span></>}
      </p>
      <p className="text-sm">
        <span className="font-display font-extrabold text-foreground">{t('money', { price: formatDzd(course.priceDzd, locale) })}</span>
        <span className="ms-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">{t('card.premium', { price: formatDzd(course.premiumPriceDzd, locale) })}</span>
      </p>
    </Link>
  );
}
