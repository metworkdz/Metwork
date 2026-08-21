import { Card, CardContent } from '@/components/ui/card';

/**
 * A single stat number + label. `value === null` renders "—" instead of a
 * figure — the money-redaction case (dev rules R-19 extended): TEAM_MEMBER
 * must never see a stray "0" that could be misread as a real amount.
 */
export function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-[var(--crm-black)]">
          {value === null ? '—' : value}
        </p>
        {hint ? <p className="mt-0.5 text-xs text-neutral-400">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
