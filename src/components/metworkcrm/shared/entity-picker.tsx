'use client';

/**
 * Debounced search-select for picking one Organization or Contact — reused by
 * the contact org-linking editor and the Task/Interaction create dialogs.
 * Queries the entity's own list endpoint with `?q=`, so results share the
 * exact same search behaviour as each list page.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';

export type EntityPickerKind = 'organization' | 'contact';

interface EntityOption {
  id: string;
  label: string;
  sublabel?: string | null;
}

const ENDPOINT: Record<EntityPickerKind, string> = {
  organization: '/api/metworkcrm/organizations',
  contact: '/api/metworkcrm/contacts',
};

function toOption(kind: EntityPickerKind, row: Record<string, unknown>): EntityOption {
  if (kind === 'organization') {
    return { id: row.id as string, label: row.name as string, sublabel: (row.city as string | null) ?? null };
  }
  return {
    id: row.id as string,
    label: (row.fullName as string | null) ?? `${row.firstName as string} ${row.lastName as string}`,
    sublabel: (row.email as string | null) ?? null,
  };
}

const PLACEHOLDER: Record<EntityPickerKind, string> = {
  organization: 'Rechercher une organisation…',
  contact: 'Rechercher un contact…',
};

export function EntityPicker({
  kind,
  value,
  onChange,
  disabled,
}: {
  kind: EntityPickerKind;
  /** Currently selected option, or null. The label is kept even if the search list changes underneath. */
  value: EntityOption | null;
  onChange: (next: EntityOption | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<EntityOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`${ENDPOINT[kind]}?${params.toString()}`);
        if (id !== requestId.current) return;
        const data = (await res.json()) as { rows: Record<string, unknown>[] };
        setOptions(res.ok ? data.rows.map((r) => toOption(kind, r)) : []);
      } catch {
        if (id === requestId.current) setOptions([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [kind, query, open]);

  return (
    <div ref={containerRef} className="relative">
      {value ? (
        <div className="flex h-11 items-center justify-between rounded-md border border-neutral-300 bg-white px-3 text-sm">
          <span className="min-w-0 truncate">
            {value.label}
            {value.sublabel ? <span className="text-neutral-400"> · {value.sublabel}</span> : null}
          </span>
          {!disabled ? (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="ms-2 inline-flex size-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
              aria-label="Retirer la sélection"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={PLACEHOLDER[kind]}
            className="h-11 w-full rounded-md border border-neutral-300 bg-white px-3 pe-9 text-sm outline-none transition-colors focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        </div>
      )}

      {open && !value ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-neutral-200 bg-white py-1 shadow-lg">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Recherche…
            </div>
          ) : options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-neutral-400">Aucun résultat.</p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                  setQuery('');
                }}
                className="flex w-full items-center px-3 py-2 text-left text-sm hover:bg-neutral-50"
              >
                <span className="min-w-0 flex-1 truncate">
                  {opt.label}
                  {opt.sublabel ? <span className="text-neutral-400"> · {opt.sublabel}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
