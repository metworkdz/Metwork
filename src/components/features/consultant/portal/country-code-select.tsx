'use client';

/**
 * Searchable country/dial-code selector for the consultant signup phone
 * field. Built on `@radix-ui/react-popover` (not the existing DropdownMenu
 * primitive) deliberately: DropdownMenu imposes `role="menu"` keyboard
 * semantics — arrow-key navigation and single-character typeahead that jumps
 * between items — which fights a free-text search input inside it. Popover
 * is an unopinionated positioned panel, so the search input behaves like a
 * normal text field and we own the list's own arrow-key handling below.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { COUNTRY_OPTIONS, countryDisplayName, type SupportedCountry } from '@/lib/country-codes';
import { CP_LIGHT_BORDER, CP_LIGHT_FAINT, CP_LIGHT_MUTED, CP_LIGHT_TEXT } from './shared';

interface CountryCodeSelectProps {
  value: SupportedCountry;
  onChange: (country: SupportedCountry) => void;
  disabled?: boolean;
  id?: string;
}

export function CountryCodeSelect({ value, onChange, disabled, id }: CountryCodeSelectProps) {
  const t = useTranslations('consultantPortal.signup');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // Localized names are recomputed only when the locale changes — Intl.DisplayNames
  // construction isn't free, so this must not re-run on every keystroke.
  const named = useMemo(
    () =>
      COUNTRY_OPTIONS.map((o) => ({ ...o, name: countryDisplayName(o.code, locale) })),
    [locale],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return named;
    return named.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.dialCode.includes(q) ||
        o.code.toLowerCase().includes(q),
    );
  }, [named, query]);

  const selected = named.find((o) => o.code === value) ?? named[0];

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Popover's own focus management moves focus to the panel; grab the
      // search input right after so typing works immediately.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function choose(code: SupportedCountry) {
    onChange(code);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[activeIndex];
      if (target) choose(target.code);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={t('countrySelectLabel')}
          className={cn(
            'flex h-12 shrink-0 items-center gap-1.5 rounded-2xl border px-3 text-base transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30a735]/20',
          )}
          style={{ borderColor: CP_LIGHT_BORDER, background: '#FFFFFF', color: CP_LIGHT_TEXT }}
        >
          <span className="text-lg leading-none">{selected?.flag}</span>
          <span className="tabular-nums">{selected?.dialCode}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 w-[calc(100vw-2.5rem)] max-w-xs overflow-hidden rounded-2xl border bg-white shadow-lg sm:w-72"
          style={{ borderColor: CP_LIGHT_BORDER }}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: CP_LIGHT_BORDER }}>
            <Search className="size-4 shrink-0" style={{ color: CP_LIGHT_FAINT }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('countrySearchPlaceholder')}
              dir="ltr"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
              style={{ color: CP_LIGHT_TEXT }}
            />
          </div>
          <div role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm" style={{ color: CP_LIGHT_MUTED }}>
                {t('countryNoResults')}
              </p>
            ) : (
              filtered.map((o, i) => (
                <button
                  key={o.code}
                  type="button"
                  role="option"
                  aria-selected={o.code === value}
                  onClick={() => choose(o.code)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors"
                  style={{
                    background: i === activeIndex ? '#F7F8F9' : 'transparent',
                    color: CP_LIGHT_TEXT,
                  }}
                >
                  <span className="text-base leading-none">{o.flag}</span>
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  <span className="shrink-0 tabular-nums" style={{ color: CP_LIGHT_FAINT }}>
                    {o.dialCode}
                  </span>
                </button>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
