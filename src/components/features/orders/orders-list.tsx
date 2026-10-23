import { getTranslations, getLocale } from 'next-intl/server';
import { Package } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { OrderView } from '@/server/orders/service';

/** A member's orders, newest first. Server component. */
export async function OrdersList({ orders, basePath, emptyHint }: { orders: OrderView[]; basePath: string; emptyHint: string }) {
  const t = await getTranslations('orders');
  const locale = (await getLocale()) as Locale;
  if (!orders.length) {
    return (
      <div className="space-y-2 rounded-lg border border-dashed p-8 text-center">
        <Package className="mx-auto size-8 text-muted-foreground" />
        <p className="text-sm font-medium">{t('emptyTitle')}</p>
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      </div>
    );
  }
  const actionable = (o: OrderView) =>
    (o.role === 'FOUNDER' && (o.status === 'AWAITING_DEPOSIT' || o.status === 'DELIVERED' || (o.status === 'COMPLETED' && !o.review)))
    || (o.role === 'FREELANCER' && o.status === 'IN_PROGRESS');
  return (
    <ul className="divide-y rounded-lg border">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`${basePath}/${o.id}`} className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/50 sm:p-4">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" dir="auto">{o.title}</span>
              <span className="block truncate text-xs text-muted-foreground"><bdi>{o.number}</bdi> · <bdi>{o.other.name}</bdi> · <bdi>{formatDate(o.createdAt, locale, { dateStyle: 'medium' })}</bdi></span>
            </span>
            <span className="shrink-0 text-end">
              <span className="block text-sm font-semibold tabular-nums">{formatCurrency(o.total, locale)}</span>
              <span className={cn('block text-xs', actionable(o) ? 'font-semibold text-primary' : 'text-muted-foreground')}>{t(`status.${o.status}`)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
