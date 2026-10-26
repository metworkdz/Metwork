import { getTranslations } from 'next-intl/server';
import { ArrowRight, Award, BadgeCheck, Languages, PlayCircle, UserRound } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { passPrices, ACADEMY_MIN_COURSE_PRICE_DZD, type AcademyPricing } from '@/lib/academy';
import { resolveText } from '@/lib/localized-text';
import type { AcademyFieldRecord } from '@/server/db/store';

/** Brand gradients for decorative tiles (Startup Academy style guide: greens only). */
const TILE_BACKGROUNDS = [
  'linear-gradient(135deg,#04150C 0%,#0B4A28 70%,#04A54F 140%)',
  'repeating-linear-gradient(115deg,rgba(255,255,255,.04) 0 2px,transparent 2px 14px),linear-gradient(160deg,#0A2617,#06331C 60%,#0F6B3A)',
  'radial-gradient(circle at 15% 20%,#18834A 0,transparent 45%),linear-gradient(140deg,#031009,#0A2E1B)',
];

function formatDzd(n: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'ar' ? 'ar-DZ' : locale === 'fr' ? 'fr-DZ' : 'en-US').format(n);
}

interface AcademyLandingProps {
  locale: string;
  pricing: AcademyPricing;
  fields: AcademyFieldRecord[];
}

/**
 * /academy for a visitor: what Startup Academy is, what they will learn and
 * how it works, before any course — then subscribe or browse.
 */
export async function AcademyLanding({ locale, pricing, fields }: AcademyLandingProps) {
  const t = await getTranslations('academy');
  const prices = passPrices(pricing);
  const premiumPercent = Math.round(pricing.premiumDiscountRate * 100);
  const annualPercent = Math.round(pricing.passAnnualDiscountRate * 100);
  const fieldLabel = (f: AcademyFieldRecord) => (f.label ? resolveText(f.label, locale) : t(`fields.${f.id}.name`));
  const fieldDesc = (f: AcademyFieldRecord) => (f.label ? '' : t(`fields.${f.id}.desc`));

  const promises = [
    { Icon: PlayCircle, key: 'short' },
    { Icon: Languages, key: 'language' },
    { Icon: UserRound, key: 'mentors' },
    { Icon: Award, key: 'certificate' },
  ] as const;

  return (
    <div>
      {/* ── Hook ── */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_85%_15%,hsl(142_65%_40%/0.16),transparent_55%)]" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[1.1fr_1fr] lg:px-8">
          <div>
            <span className="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-primary">
              {t('landing.eyebrow')}
            </span>
            <h1 className="mt-5 text-balance font-display text-4xl font-extrabold leading-[1.04] tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {t('landing.titleStart')} <span className="text-primary">{t('landing.titleHighlight')}</span>
            </h1>
            <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t('landing.subtitle')}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="font-bold">
                <Link href="/academy/pass">
                  {t('landing.ctaSubscribe', { price: formatDzd(prices.monthly, locale) })}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="font-bold">
                <Link href="/academy/courses">
                  {t('landing.ctaCourses')} <ArrowRight className="ms-1 size-4 rtl:rotate-180" aria-hidden />
                </Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              {t('landing.orBuy', { price: formatDzd(ACADEMY_MIN_COURSE_PRICE_DZD, locale), percent: premiumPercent })}
            </p>
          </div>

          {/* Decorative composition — the course look, without promising a course list yet. */}
          <div aria-hidden className="relative mx-auto h-[300px] w-full max-w-md sm:h-[380px] lg:max-w-none">
            {[0, 1].map((i) => {
              const f = fields[i];
              return (
                <div
                  key={i}
                  className={i === 0
                    ? 'absolute end-0 top-0 aspect-video w-[78%] rounded-2xl p-4 shadow-2xl shadow-primary/20'
                    : 'absolute start-0 top-[30%] aspect-video w-[62%] rounded-2xl p-4 shadow-2xl shadow-primary/20'}
                  style={{ background: TILE_BACKGROUNDS[i] }}
                >
                  {/* The back tile's title sits at the top: the front tile covers its lower half. */}
                  <div className={`flex h-full flex-col text-white ${i === 0 ? 'justify-start' : 'justify-end'}`}>
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#9FF5C2]">{f ? fieldLabel(f) : ''}</span>
                    <span className="mt-1 max-w-[80%] font-display text-lg font-extrabold leading-tight sm:text-xl">{t(`landing.tile${i + 1}`)}</span>
                  </div>
                </div>
              );
            })}
            <div className="absolute bottom-0 end-[6%] w-[64%] rounded-2xl border border-border bg-card p-4 shadow-xl">
              <p className="text-sm font-bold text-foreground">{t('landing.cardTitle')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('landing.cardMeta')}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full w-[57%] rounded-full bg-primary" />
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 pb-12 sm:px-6 lg:grid-cols-4 lg:px-8">
          {promises.map(({ Icon, key }) => (
            <div key={key} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{t(`landing.promise.${key}.title`)}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{t(`landing.promise.${key}.desc`)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── What you will learn ── */}
      <section id="learn" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <h2 className="text-balance font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('landing.learnTitle')}</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t('landing.learnSubtitle')}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map((f) => (
            <div key={f.id} className="rounded-2xl border border-border bg-card p-5">
              <p className="font-display text-base font-extrabold text-foreground">{fieldLabel(f)}</p>
              {fieldDesc(f) && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{fieldDesc(f)}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-balance font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">{t('landing.howTitle')}</h2>
          <ol className="mt-8 grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="rounded-2xl border border-border bg-card p-5">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary font-display text-sm font-extrabold text-primary-foreground">{n}</span>
                <p className="mt-3 font-display text-base font-extrabold text-foreground">{t(`landing.step${n}Title`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(`landing.step${n}Desc`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The Pass ── */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div
          className="flex flex-col gap-6 rounded-3xl p-7 text-white sm:p-10 lg:flex-row lg:items-center"
          style={{ background: 'linear-gradient(120deg,#057A41 0%,#049B4C 60%,#04A54F 100%)' }}
        >
          <div className="flex-1">
            <p className="text-xs font-extrabold uppercase tracking-[0.2em] text-white/80">{t('landing.passEyebrow')}</p>
            <h2 className="mt-2 text-balance font-display text-2xl font-extrabold sm:text-3xl">{t('landing.passTitle')}</h2>
            <p className="mt-2 text-white/85">{t('landing.passDesc', { annual: annualPercent, premium: premiumPercent })}</p>
          </div>
          <div className="lg:text-end">
            <p className="font-display text-3xl font-extrabold">
              {t('landing.perMonth', { price: formatDzd(prices.monthly, locale) })}
            </p>
            <p className="text-sm text-white/80">{t('landing.perYear', { price: formatDzd(prices.annual, locale) })}</p>
          </div>
          <Button asChild size="lg" className="bg-white font-bold text-[#04150C] hover:bg-white/90">
            <Link href="/academy/pass">{t('landing.passCta')}</Link>
          </Button>
        </div>
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <BadgeCheck className="size-4 text-primary" aria-hidden />
          {t('landing.protected')}
        </p>
      </section>
    </div>
  );
}
