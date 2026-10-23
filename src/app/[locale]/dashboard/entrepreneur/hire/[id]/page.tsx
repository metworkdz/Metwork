import { notFound } from 'next/navigation';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, BadgeCheck, Clock, ExternalLink, MapPin, RefreshCw, Wifi } from 'lucide-react';
import { requireRole } from '@/lib/auth-guards';
import { Link } from '@/i18n/routing';
import { MemberBadge } from '@/components/shared/member-badge';
import { ContactButton } from '@/components/features/messaging/contact-button';
import { QuoteDialog } from '@/components/features/hiring/quote-dialog';
import { db } from '@/server/db/store';
import { freelancerProfile } from '@/server/hiring/directory';
import { quotesUsedThisMonth } from '@/server/hiring/quotes';
import { entitlementsForUser } from '@/lib/entitlements';
import { getCityName } from '@/config/cities';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const p = freelancerProfile(await db.read(), id);
  return { title: p?.name ?? '' };
}

/** A freelancer's full profile, as founders see it from the hiring tab. */
export default async function FreelancerProfilePage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const lang = locale as Locale;
  const t = await getTranslations('hiring');
  const session = await requireRole(['ENTREPRENEUR']);
  const data = await db.read();
  const p = freelancerProfile(data, id);
  if (!p) notFound();
  const me = data.users.find((u) => u.id === session.id) ?? session;
  const ent = entitlementsForUser(me);
  const limit = ent?.audience === 'ENTREPRENEUR' ? ent.quoteRequestsPerMonth : 0;
  const remaining = limit === null ? null : Math.max(0, limit - quotesUsedThisMonth(data, session.id));
  const first = p.name.split(' ')[0] ?? p.name;
  const returnPath = `/dashboard/entrepreneur/hire/${p.id}`;

  return (
    <div className="space-y-6">
      <Link href="/dashboard/entrepreneur/hire" className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-medium text-primary hover:underline">
        <ArrowLeft className="size-4 rtl:rotate-180" />{t('back')}
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          {p.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar, sized here
            <img src={p.avatarUrl} alt="" className="size-16 shrink-0 rounded-full object-cover" />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-50 text-lg font-semibold text-primary-700">
              {p.name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()}
            </span>
          )}
          <div className="min-w-0 space-y-1">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
              {p.name}
              <MemberBadge badge={p.badge} />
              {p.verified && <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"><BadgeCheck className="size-3.5" />{t('verifiedLong')}</span>}
            </h1>
            <p className="text-muted-foreground">{p.headline}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {p.city && <span className="inline-flex items-center gap-1"><MapPin className="size-4" />{getCityName(p.city, lang)}</span>}
              {p.remote && <span className="inline-flex items-center gap-1"><Wifi className="size-4" />{t('remote')}</span>}
              <span>{t('memberSince', { date: formatDate(p.memberSince, lang, { month: 'long', year: 'numeric' }) })}</span>
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <QuoteDialog freelancerId={p.id} freelancerName={first} remaining={remaining} />
          {p.dayRate && <p className="text-sm text-muted-foreground">{t('dayRate', { price: formatCurrency(p.dayRate, lang) })}</p>}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {p.bio && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t('about')}</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed" dir="auto">{p.bio}</p>
            </section>
          )}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{t('skills')}</h2>
            <div className="flex flex-wrap gap-1.5">{p.skills.map((s) => <span key={s} className="rounded-full border px-2.5 py-1 text-sm">{s}</span>)}</div>
            {p.languages.length > 0 && <p className="text-sm text-muted-foreground">{t('languages')}: {p.languages.join(', ')}</p>}
          </section>
          {p.portfolio.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t('portfolio')}</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {p.portfolio.map((item) => {
                  const body = (
                    <>
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- portfolio thumbnails
                        <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full rounded-lg border object-cover" />
                      ) : (
                        <span className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">{item.title}</span>
                      )}
                      <span className="mt-1 flex items-center gap-1 truncate text-xs">{item.title}{item.url && <ExternalLink className="size-3 shrink-0" />}</span>
                    </>
                  );
                  return item.url ? (
                    <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer nofollow" className="block min-w-0">{body}</a>
                  ) : (
                    <div key={item.id} className="min-w-0">{body}</div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-3">
          <h2 className="text-sm font-semibold">{t('gigs', { count: p.gigs.length })}</h2>
          {p.gigs.length === 0 && <p className="text-sm text-muted-foreground">{t('noGigs')}</p>}
          {p.gigs.map((g) => (
            <div key={g.id} className="space-y-2 rounded-xl border p-4">
              <p className="font-semibold leading-snug" dir="auto">{g.title}</p>
              {g.description && <p className="line-clamp-4 text-sm text-muted-foreground" dir="auto">{g.description}</p>}
              <p className="text-xl font-bold tabular-nums">{formatCurrency(g.price, lang)}</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock className="size-3.5" />{t('days', { count: g.deliveryDays })}</span>
                <span className="inline-flex items-center gap-1"><RefreshCw className="size-3.5" />{t('revisions', { count: g.revisions })}</span>
              </p>
              <div className="flex flex-col gap-2">
                <QuoteDialog freelancerId={p.id} freelancerName={first} gig={{ id: g.id, title: g.title }} remaining={remaining} variant="outline" size="sm" />
                <ContactButton toId={p.id} toName={first} contextType="GIG_ORDER" contextId={g.id} viewerRole="ENTREPRENEUR" returnPath={returnPath} label={t('askQuestion')} variant="ghost" size="sm" />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
