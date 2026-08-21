import Link from 'next/link';
import { cn } from '@/lib/utils';

export const DASHBOARD_VIEWS = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'urgent', label: 'Urgent' },
  { key: 'commercial', label: 'Commercial' },
  { key: 'ecosystem', label: 'Écosystème' },
  { key: 'oi', label: 'Open Innovation' },
  { key: 'programs', label: 'Programmes' },
] as const;

export type DashboardViewKey = (typeof DASHBOARD_VIEWS)[number]['key'];

export function isDashboardViewKey(value: string | undefined): value is DashboardViewKey {
  return DASHBOARD_VIEWS.some((v) => v.key === value);
}

/**
 * Server-rendered view switcher — a `?view=` link per tab, no client JS.
 * The platform has no Tabs primitive and the brief bans hydration-sensitive
 * layout (`useMediaQuery`); a plain link list is the simplest thing that
 * cannot desync between server and client render.
 */
export function DashboardNav({ active }: { active: DashboardViewKey }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-neutral-200">
      {DASHBOARD_VIEWS.map((view) => (
        <Link
          key={view.key}
          href={view.key === 'today' ? '/metworkcrm' : `/metworkcrm?view=${view.key}`}
          className={cn(
            'rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
            active === view.key
              ? 'border-b-2 border-[var(--crm-green)] text-[var(--crm-black)]'
              : 'text-neutral-500 hover:text-[var(--crm-black)]',
          )}
        >
          {view.label}
        </Link>
      ))}
    </nav>
  );
}
