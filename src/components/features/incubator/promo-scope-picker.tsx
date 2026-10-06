'use client';

/**
 * Where a promo code works: a checklist of the incubator's programs and spaces.
 *
 * Explicit ids, never "all" — a program created next month is not silently
 * included, which is the point of the feature. "Select all" therefore ticks the
 * rows currently shown rather than flipping a hidden wildcard.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export interface PickerProgram { id: string; title: string; city?: string }
export interface PickerSpace { id: string; name: string; city?: string }
export interface PromoScopeValue { programIds: string[]; spaceIds: string[] }

interface Props {
  programs: PickerProgram[];
  spaces: PickerSpace[];
  value: PromoScopeValue;
  onChange: (next: PromoScopeValue) => void;
  disabled?: boolean;
}

function Group({
  title, items, selected, onToggle, onAll, onNone, disabled, labels,
}: {
  title: string;
  items: Array<{ id: string; label: string; hint?: string }>;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  disabled?: boolean;
  labels: { all: string; none: string; empty: string };
}) {
  return (
    <div>
      <div className="flex items-center justify-between bg-muted/50 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <span className="flex gap-3 text-xs font-medium">
          <button type="button" onClick={onAll} disabled={disabled || items.length === 0} className="text-primary hover:underline disabled:opacity-40">
            {labels.all}
          </button>
          <button type="button" onClick={onNone} disabled={disabled || items.length === 0} className="text-muted-foreground hover:underline disabled:opacity-40">
            {labels.none}
          </button>
        </span>
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="max-h-52 overflow-y-auto">
          {items.map((it) => (
            <li key={it.id} className="border-t border-border first:border-t-0">
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="size-[18px] shrink-0 accent-[hsl(var(--primary))]"
                  checked={selected.has(it.id)}
                  onChange={() => onToggle(it.id)}
                  disabled={disabled}
                />
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="shrink-0 text-xs text-muted-foreground">{it.hint}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PromoScopePicker({ programs, spaces, value, onChange, disabled }: Props) {
  const t = useTranslations('incubator.promoCodes');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const progRows = useMemo(
    () => programs
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .map((p) => ({ id: p.id, label: p.title, hint: p.city })),
    [programs, q],
  );
  const spaceRows = useMemo(
    () => spaces
      .filter((s) => !q || s.name.toLowerCase().includes(q))
      .map((s) => ({ id: s.id, label: s.name, hint: s.city })),
    [spaces, q],
  );

  const progSel = new Set(value.programIds);
  const spaceSel = new Set(value.spaceIds);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const addAll = (list: string[], ids: string[]) => [...new Set([...list, ...ids])];
  const removeAll = (list: string[], ids: string[]) => list.filter((x) => !ids.includes(x));
  const count = value.programIds.length + value.spaceIds.length;
  const showSearch = programs.length + spaces.length > 8;

  const labels = { all: t('selectAll'), none: t('clear'), empty: t('nothingFound') };

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-border">
        {showSearch && (
          <div className="relative border-b border-border">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              className="rounded-none border-0 ps-9 focus-visible:ring-0"
            />
          </div>
        )}
        <Group
          title={t('programsGroup')}
          items={progRows}
          selected={progSel}
          disabled={disabled}
          labels={labels}
          onToggle={(id) => onChange({ ...value, programIds: toggle(value.programIds, id) })}
          onAll={() => onChange({ ...value, programIds: addAll(value.programIds, progRows.map((r) => r.id)) })}
          onNone={() => onChange({ ...value, programIds: removeAll(value.programIds, progRows.map((r) => r.id)) })}
        />
        <div className="border-t border-border">
          <Group
            title={t('spacesGroup')}
            items={spaceRows}
            selected={spaceSel}
            disabled={disabled}
            labels={labels}
            onToggle={(id) => onChange({ ...value, spaceIds: toggle(value.spaceIds, id) })}
            onAll={() => onChange({ ...value, spaceIds: addAll(value.spaceIds, spaceRows.map((r) => r.id)) })}
            onNone={() => onChange({ ...value, spaceIds: removeAll(value.spaceIds, spaceRows.map((r) => r.id)) })}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('selectedCount', { count })} · {t('newListingsNote')}
      </p>
    </div>
  );
}
