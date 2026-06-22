'use client';

/**
 * Searchable client combobox for the manual-booking form.
 *
 * - Opening lists ALL of this incubator's clients (one fetch, cached).
 * - A search box filters by name / email / phone / company (debounced ~250ms,
 *   client-side over the loaded list — no extra round-trips).
 * - A pinned "Add new client" row is ALWAYS visible (even with no matches /
 *   no clients) and opens the existing ClientFormDialog. On create the record
 *   is appended to the local list, auto-selected, and persisted via the same
 *   /api/incubator/clients POST the clients page uses (no second code path).
 * - Fully keyboard accessible (↑/↓/Enter/Esc); full-width + tappable on mobile.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, ChevronsUpDown, Loader2, Plus, UserCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClientFormDialog, type CreatedClient } from './client-form-dialog';

export interface PickedClient {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string | null;
}

interface ClientPickerProps {
  /** Current selection (controlled), or null. */
  value: PickedClient | null;
  /** Called with the chosen client, or null when cleared. */
  onSelect: (client: PickedClient | null) => void;
  id?: string;
  disabled?: boolean;
}

export function ClientPicker({ value, onSelect, id, disabled }: ClientPickerProps) {
  const t = useTranslations('incubator.clientPicker');

  const [open, setOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [clients, setClients] = useState<PickedClient[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch the full client list once, lazily on first open. `loading` is
  // intentionally NOT a dependency — including it would re-run the effect when
  // setLoading(true) fires and cancel the in-flight request before it resolves.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch('/api/incubator/clients', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { items: PickedClient[] };
        if (!cancelled) { setClients(data.items ?? []); setLoaded(true); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loaded]);

  // Reset the search + focus when (re)opening.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebouncedQuery('');
    setActiveIndex(0);
    const tid = setTimeout(() => searchRef.current?.focus(), 0);
    return () => clearTimeout(tid);
  }, [open]);

  // Debounce the filter ~250ms.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Reset the keyboard cursor whenever the filtered set changes.
  useEffect(() => { setActiveIndex(0); }, [debouncedQuery]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return clients;
    return clients.filter((c) =>
      c.fullName.toLowerCase().includes(debouncedQuery) ||
      c.email.toLowerCase().includes(debouncedQuery) ||
      c.phone.toLowerCase().includes(debouncedQuery) ||
      (c.companyName ?? '').toLowerCase().includes(debouncedQuery),
    );
  }, [clients, debouncedQuery]);

  // The pinned "add new" row is the last selectable index.
  const addIndex = filtered.length;
  const optionCount = filtered.length + 1;

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  function choose(client: PickedClient) {
    onSelect(client);
    setClients((prev) => (prev.some((c) => c.id === client.id) ? prev : [client, ...prev]));
    setOpen(false);
  }

  function handleCreated(record: CreatedClient) {
    const picked: PickedClient = {
      id: record.id,
      fullName: record.fullName,
      email: record.email,
      phone: record.phone,
      companyName: record.companyName,
    };
    setClients((prev) => [picked, ...prev.filter((c) => c.id !== picked.id)]);
    setLoaded(true);
    onSelect(picked);
    setFormOpen(false);
    setOpen(false);
  }

  function onSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, optionCount - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex === addIndex) setFormOpen(true);
      else { const c = filtered[activeIndex]; if (c) choose(c); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger — styled like an Input */}
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background pe-9 ps-3 text-sm ring-offset-background',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span className={cn('truncate text-start', !value && 'text-muted-foreground')}>
          {value ? value.fullName : t('triggerPlaceholder')}
        </span>
      </button>

      {/* Clear (when selected) / chevron (otherwise) — sibling, not nested in the button */}
      <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">
        {value ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={t('clearAriaLabel')}
            onClick={() => onSelect(null)}
            className="pointer-events-auto text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        )}
      </span>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md">
          {/* Search */}
          <div className="border-b border-border p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder={t('searchPlaceholder')}
              role="combobox"
              aria-expanded
              aria-controls="client-picker-list"
              aria-autocomplete="list"
              autoComplete="off"
              className="w-full bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* List */}
          <div id="client-picker-list" ref={listRef} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {loading && !loaded ? (
              <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t('loading')}
              </div>
            ) : (
              <>
                {filtered.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {clients.length === 0 ? t('empty') : t('noMatch')}
                  </div>
                )}
                {filtered.map((c, i) => {
                  const secondary = c.companyName
                    ? `${c.companyName}${c.email || c.phone ? ' · ' : ''}${c.email || c.phone}`
                    : (c.email || c.phone);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      data-idx={i}
                      aria-selected={value?.id === c.id}
                      onMouseEnter={() => setActiveIndex(i)}
                      onMouseDown={(e) => { e.preventDefault(); choose(c); }}
                      className={cn(
                        'flex w-full items-start gap-2 px-3 py-2 text-start text-sm transition-colors',
                        i === activeIndex ? 'bg-accent' : 'hover:bg-accent',
                      )}
                    >
                      <UserCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.fullName}</span>
                        {secondary && (
                          <span className="block truncate text-xs text-muted-foreground">{secondary}</span>
                        )}
                      </span>
                      {value?.id === c.id && <Check className="mt-0.5 size-4 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Pinned "Add new client" — always visible */}
          <button
            type="button"
            role="option"
            data-idx={addIndex}
            aria-selected={activeIndex === addIndex}
            onMouseEnter={() => setActiveIndex(addIndex)}
            onMouseDown={(e) => { e.preventDefault(); setFormOpen(true); }}
            className={cn(
              'flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-start text-sm font-medium text-primary transition-colors',
              activeIndex === addIndex ? 'bg-primary/10' : 'hover:bg-primary/5',
            )}
          >
            <Plus className="size-4 shrink-0" />
            {t('addNew')}
          </button>
        </div>
      )}

      {/* Inline create — controlled, rendered at root so it survives the dropdown closing */}
      <ClientFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={() => undefined}
        onCreated={handleCreated}
      />
    </div>
  );
}
