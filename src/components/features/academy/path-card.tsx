import { getTranslations } from 'next-intl/server';
import { Layers } from 'lucide-react';
import { Link } from '@/i18n/routing';
import type { PublicBundle } from '@/server/academy/bundles';
import { formatDzd } from './format';

/** A learning path in a list: its courses, its price and the saving. Server component. */
export async function PathCard({ path, locale }: { path: PublicBundle; locale: string }) {
  const t = await getTranslations('academy');
  const saving = path.listTotalDzd - path.priceDzd;
  return (
    <Link href={`/academy/paths/${path.slug}`} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4 hover:border-primary">
      <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary"><Layers className="size-4" aria-hidden />{t('paths.eyebrow', { count: path.courses.length })}</span>
      <span className="line-clamp-2 font-display text-lg font-extrabold leading-snug">{path.title}</span>
      <ol className="space-y-1 text-sm text-muted-foreground">
        {path.courses.slice(0, 4).map((c, i) => <li key={c.id} className="truncate">{i + 1}. {c.title}</li>)}
        {path.courses.length > 4 && <li>…</li>}
      </ol>
      <span className="mt-auto text-sm">
        <span className="font-display font-extrabold">{t('money', { price: formatDzd(path.priceDzd, locale) })}</span>
        {saving > 0 && <span className="ms-2 text-xs text-muted-foreground line-through">{t('money', { price: formatDzd(path.listTotalDzd, locale) })}</span>}
      </span>
    </Link>
  );
}
