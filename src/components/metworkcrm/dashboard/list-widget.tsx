import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { DashboardListItem } from '@/server/metworkcrm/services/dashboard';

function formatMeta(meta: string | null): string | null {
  if (!meta) return null;
  // Dates come back as `YYYY-MM-DD` or full ISO timestamps depending on the
  // source column — both parse fine, only render the ones that look date-like.
  if (/^\d{4}-\d{2}-\d{2}/.test(meta)) {
    return new Date(meta).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  }
  return meta;
}

/**
 * A short, glanceable row list for one dashboard section. Tasks/Interactions
 * have no standalone detail page (Prompt 2 — they're managed inline via the
 * Tasks/Activités lists), so rows are plain text; only entities with a real
 * detail page get a `seeAllHref` link at the bottom of the section instead of
 * per-row deep links, keeping this pass's scope to display, not navigation.
 */
export function ListWidget({
  title,
  items,
  emptyLabel,
  seeAllHref,
  seeAllLabel,
}: {
  title: string;
  items: DashboardListItem[];
  emptyLabel: string;
  seeAllHref?: string;
  seeAllLabel?: string;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {items.length === 0 ? (
          <p className="py-2 text-sm text-neutral-400">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {items.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--crm-black)]">{item.title}</p>
                  {item.subtitle ? <p className="truncate text-xs text-neutral-500">{item.subtitle}</p> : null}
                </div>
                {item.meta ? (
                  <Badge variant="outline" className="shrink-0 text-xs font-normal text-neutral-500">
                    {formatMeta(item.meta)}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {seeAllHref ? (
          <Link href={seeAllHref} className="mt-2 inline-block text-xs font-medium text-[var(--crm-green)] hover:underline">
            {seeAllLabel ?? 'Voir tout'} →
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}
