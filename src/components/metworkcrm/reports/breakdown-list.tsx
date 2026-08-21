import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** A labeled count/amount list inside a card — sector/stage/type distributions. */
export function BreakdownList({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: { label: string; value: string | number }[];
  emptyLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-neutral-400">{emptyLabel}</p>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <li key={row.label} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-neutral-600">{row.label}</span>
                <span className="font-medium text-[var(--crm-black)]">{row.value}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
