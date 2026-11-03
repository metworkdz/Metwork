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
import { isLiveModule } from '@/lib/academy';
import { CourseCover } from '@/components/features/academy/course-cover';
import { RefundButton } from '@/components/features/academy/refund-button';
import { formatDzd } from '@/components/features/academy/format';
import { PassCard } from '@/components/features/academy/pass-card';
import { passStatusFor } from '@/server/academy/pass';
import { listPublicCourses } from '@/server/academy/catalog';
import { listAcademyFields } from '@/server/academy/settings';
import { listMyCertificates } from '@/server/academy/certificates';
import { CourseCard } from '@/components/features/academy/course-card';
import { RemindersToggle } from '@/components/features/academy/reminders-toggle';
import { ReferralCard } from '@/components/features/academy/referral-card';
import { MyGifts } from '@/components/features/academy/my-gifts';
import { referralSummary } from '@/server/academy/referral';
import { listMyGifts } from '@/server/academy/gifts';
import { Award, Download, ShieldCheck } from 'lucide-react';

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

  const pass = await passStatusFor(session.user);
  const me = d.users.find((u) => u.id === session.user.id);
  const wishIds = me?.academyWishlist ?? [];
  const [referral, gifts] = await Promise.all([referralSummary(session.user.id), listMyGifts(session.user.id, locale)]);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz').replace(/\/+$/, '');
  const [certificates, published] = await Promise.all([listMyCertificates(session.user.id), wishIds.length ? listPublicCourses(locale) : Promise.resolve([])]);
  const fields = wishIds.length ? await listAcademyFields({ includeHidden: true }) : [];
  const fieldLabel = (id: string) => { const f = fields.find((x) => x.id === id); return f?.label ? resolveText(f.label, locale) : t(`fields.${id}.name`); };
  const wishlist = wishIds.map((id) => published.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const dateLocale = locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-GB';
  const rows = await Promise.all(mine.map(async (e) => {
    const course = d.academyCourses?.find((c) => c.id === e.courseId);
    if (!course) return null;
    const lessons = course.modules.filter(isLiveModule).flatMap((m) => m.lessons);
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
      {pass.active && (
        <div className="mt-6">
          <PassCard
            plan={pass.active.plan}
            until={new Date(pass.active.periodEnd).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })}
            autoRenew={pass.active.autoRenew}
            renewalAmount={t('money', { price: formatDzd(pass.quotes.MONTHLY.amountDzd, locale) })}
          />
        </div>
      )}
      {rows.filter(Boolean).length === 0 && !pass.active ? (
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

      {certificates.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-extrabold">{t('learning.my.certificates')}</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {certificates.map((c) => (
              <li key={c.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                <Award className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{c.courseTitle}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground"><span dir="ltr">{c.number}</span> · {new Date(c.issuedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <a href={`/api/academy/certificates/${c.id}/pdf`} className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"><Download className="size-4" aria-hidden />{t('learning.certificate.download')}</a>
                    <Link href={`/attestation/${c.verifyToken}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ShieldCheck className="size-4" aria-hidden />{t('learning.certificate.verify')}</Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {wishlist.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-extrabold">{t('learning.my.wishlist')}</h2>
          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {wishlist.map((c) => <CourseCard key={c.id} course={c} locale={locale} fieldLabel={fieldLabel(c.fieldId)} />)}
          </div>
        </section>
      )}

      {gifts.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-extrabold">{t('gift.mine.title')}</h2>
          <div className="mt-4"><MyGifts gifts={gifts} /></div>
        </section>
      )}

      {referral && (
        <section className="mt-10">
          <ReferralCard
            link={`${appUrl}/${locale}/academy?ref=${referral.code}`}
            invited={referral.invited}
            pending={referral.pending}
            earned={t('money', { price: formatDzd(referral.earnedDzd, locale) })}
          />
        </section>
      )}

      <section className="mt-10">
        <RemindersToggle initialOff={Boolean(me?.academyRemindersOff)} />
      </section>
    </div>
  );
}
