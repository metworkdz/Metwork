import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Linkedin, MapPin } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { getPublicMentor } from '@/server/academy/catalog';
import { listAcademyFields } from '@/server/academy/settings';
import { resolveText } from '@/lib/localized-text';
import { CourseCard } from '@/components/features/academy/course-card';

export const revalidate = 60;

interface PageProps { params: Promise<{ locale: string; slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const m = await getPublicMentor(slug, locale);
  if (!m) return {};
  const t = await getTranslations('academy.mentor');
  return { title: t('metaTitle', { name: m.fullName }), description: (m.bio ?? m.position).slice(0, 160) };
}

export default async function AcademyMentorPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const mentor = await getPublicMentor(slug, locale);
  if (!mentor) notFound();
  const t = await getTranslations('academy');
  const fields = await listAcademyFields({ includeHidden: true });
  const fieldLabel = (id: string) => {
    const f = fields.find((x) => x.id === id);
    return f?.label ? resolveText(f.label, locale) : t(`fields.${id}.name`);
  };
  const linkedin = mentor.linkedinUrl && /^https:\/\//.test(mentor.linkedinUrl) ? mentor.linkedinUrl : null;

  return (
    <div>
      <div className="h-32 sm:h-40" style={{ background: 'linear-gradient(120deg,#057A41,#04150C 75%)' }} />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 pb-14 sm:px-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:px-8">
        <aside className="-mt-14 space-y-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {mentor.avatarUrl ? <img src={mentor.avatarUrl} alt="" className="size-28 rounded-full border-4 border-background object-cover" />
            : <span className="flex size-28 items-center justify-center rounded-full border-4 border-background bg-primary font-display text-4xl font-extrabold text-primary-foreground">{mentor.fullName.slice(0, 1)}</span>}
          <div>
            <h1 className="font-display text-2xl font-extrabold">{mentor.fullName}</h1>
            <p className="text-sm text-muted-foreground">{mentor.position}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
            {mentor.city && <span className="flex items-center gap-1"><MapPin className="size-4" aria-hidden />{mentor.city}</span>}
            {linkedin && <a href={linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground"><Linkedin className="size-4" aria-hidden />LinkedIn</a>}
          </div>
          {mentor.bio && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{mentor.bio}</p>}
          {mentor.bookable && (
            <div className="rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold">{t('mentor.consultTitle')}</p>
              <p className="mb-3 text-xs text-muted-foreground">{t('mentor.consultDesc')}</p>
              <Button asChild size="sm" className="w-full"><Link href={`/mentors/${mentor.slug}`}>{t('mentor.consultCta')}</Link></Button>
            </div>
          )}
        </aside>
        <section className="pt-8">
          <h2 className="font-display text-xl font-extrabold">{t('mentor.courses', { count: mentor.courses.length })}</h2>
          <div className="mt-5 grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3">
            {mentor.courses.map((c) => <CourseCard key={c.id} course={c} locale={locale} fieldLabel={fieldLabel(c.fieldId)} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
