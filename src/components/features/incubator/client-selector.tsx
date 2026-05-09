'use client';

/**
 * Autocomplete input that searches clients via GET /api/incubator/clients/search?q=
 * Returns a selected client or clears when the user wipes the input.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, UserCircle, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface ClientHit {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string | null;
}

interface ClientSelectorProps {
  /** Called with the selected client, or null when cleared. */
  onSelect: (client: ClientHit | null) => void;
  /** Current selection (controlled). */
  value?: ClientHit | null;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}

export function ClientSelector({
  onSelect,
  value,
  placeholder = 'Search by name, email, phone…',
  disabled,
  id,
}: ClientSelectorProps) {
  const [query, setQuery] = useState(value?.fullName ?? '');
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync display when parent clears the value
  useEffect(() => {
    if (!value) setQuery('');
    else setQuery(value.fullName);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleChange(q: string) {
    setQuery(q);
    if (!q.trim()) {
      onSelect(null);
      setHits([]);
      setOpen(false);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/incubator/clients/search?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) return;
        const data = await res.json() as { items: ClientHit[] };
        setHits(data.items);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
  }

  function select(hit: ClientHit) {
    onSelect(hit);
    setQuery(hit.fullName);
    setOpen(false);
    setHits([]);
  }

  function clear() {
    onSelect(null);
    setQuery('');
    setHits([]);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className="pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
        {!loading && query && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
            aria-label="Clear"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {open && hits.length > 0 && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
          {hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className={cn(
                'flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors',
              )}
              onMouseDown={(e) => { e.preventDefault(); select(hit); }}
            >
              <UserCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-medium">{hit.fullName}</div>
                {(hit.email || hit.companyName) && (
                  <div className="text-xs text-muted-foreground">
                    {hit.companyName ? `${hit.companyName} · ` : ''}
                    {hit.email}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {open && hits.length === 0 && !loading && query.trim().length >= 1 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md">
          No clients found — they will be created automatically.
        </div>
      )}
    </div>
  );
}
