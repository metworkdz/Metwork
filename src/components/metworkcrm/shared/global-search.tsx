'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Building2, CalendarRange, FolderKanban, Handshake, Lightbulb, ListChecks, MessagesSquare, Rocket, Search, Target, UsersRound } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Duplicated from the (server-only) search service rather than imported —
 * this is a client component, and importing across that boundary risks
 * pulling `getCrmDb`/better-sqlite3 into the client bundle even via a
 * type-only import. Cheap to keep in sync by hand.
 */
type SearchResultKind =
  | 'ORGANIZATION' | 'CONTACT' | 'TASK' | 'INTERACTION'
  | 'OPPORTUNITY' | 'STARTUP' | 'EXPERT' | 'PARTNERSHIP'
  | 'OI_PROJECT' | 'PROGRAM';

interface SearchResultRow {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string | null;
}
interface SearchResultGroup {
  kind: SearchResultKind;
  items: SearchResultRow[];
}

const KIND_LABEL: Record<SearchResultKind, string> = {
  ORGANIZATION: 'Organisations',
  CONTACT: 'Contacts',
  OPPORTUNITY: 'Opportunités',
  STARTUP: 'Startups',
  EXPERT: 'Experts',
  PARTNERSHIP: 'Partenariats',
  OI_PROJECT: 'Open Innovation',
  PROGRAM: 'Programmes',
  TASK: 'Tâches',
  INTERACTION: 'Interactions',
};

const KIND_ICON: Record<SearchResultKind, typeof Building2> = {
  ORGANIZATION: Building2,
  CONTACT: Target,
  OPPORTUNITY: FolderKanban,
  STARTUP: Rocket,
  EXPERT: UsersRound,
  PARTNERSHIP: Handshake,
  OI_PROJECT: Lightbulb,
  PROGRAM: CalendarRange,
  TASK: ListChecks,
  INTERACTION: MessagesSquare,
};

/**
 * Where a result sends the user. Tasks and Interactions have no detail page
 * (they're edited from their list views), so a click lands on the relevant
 * list rather than a dedicated page.
 */
function resultHref(row: SearchResultRow): string {
  switch (row.kind) {
    case 'ORGANIZATION':
      return `/metworkcrm/organizations/${row.id}`;
    case 'CONTACT':
      return `/metworkcrm/contacts/${row.id}`;
    case 'OPPORTUNITY':
      return `/metworkcrm/sales/${row.id}`;
    case 'STARTUP':
      return `/metworkcrm/startups/${row.id}`;
    case 'EXPERT':
      return `/metworkcrm/experts/${row.id}`;
    case 'PARTNERSHIP':
      return `/metworkcrm/partnerships/${row.id}`;
    case 'OI_PROJECT':
      return `/metworkcrm/open-innovation/${row.id}`;
    case 'PROGRAM':
      return `/metworkcrm/programs/${row.id}`;
    case 'TASK':
      return '/metworkcrm/tasks';
    case 'INTERACTION':
      return '/metworkcrm/activities';
  }
}

export function GlobalSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<SearchResultGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Close the dropdown on navigation so a stale result list never lingers.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/metworkcrm/search?q=${encodeURIComponent(trimmed)}`);
        if (id !== requestId.current) return; // a newer keystroke superseded this request
        const data = (await res.json()) as { groups: SearchResultGroup[] };
        setGroups(res.ok ? data.groups : []);
      } catch {
        if (id === requestId.current) setGroups([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  function goTo(row: SearchResultRow) {
    setOpen(false);
    setQuery('');
    router.push(resultHref(row));
  }

  const hasResults = groups.some((g) => g.items.length > 0);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
          placeholder="Rechercher dans le CRM…"
          aria-label="Recherche globale"
          className="h-10 w-full rounded-md border border-neutral-300 bg-white ps-9 pe-3 text-sm outline-none transition-colors focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20"
        />
      </div>

      {open && query.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-[70vh] overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1.5 shadow-lg">
          {loading ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Recherche…</p>
          ) : !hasResults ? (
            <p className="px-4 py-3 text-sm text-neutral-400">Aucun résultat pour « {query.trim()} ».</p>
          ) : (
            groups.map((group) => {
              const Icon = KIND_ICON[group.kind];
              return (
                <div key={group.kind} className="mb-1 last:mb-0">
                  <p className="px-4 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-neutral-400">
                    {KIND_LABEL[group.kind]}
                  </p>
                  {group.items.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => goTo(row)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-50',
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-neutral-400" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[var(--crm-black)]">{row.title}</span>
                        {row.subtitle ? (
                          <span className="block truncate text-xs text-neutral-400">{row.subtitle}</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
