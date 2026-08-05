'use client';

/**
 * Multi-select category chip row — shared by the public /mentors page and
 * the dashboard consultations page. "All" is derived (selected.length === 0),
 * not a real chip value, so it can never fall out of sync with the actual
 * selection: picking a category deselects "All" automatically, and
 * deselecting the last category re-activates it.
 *
 * Horizontal scroll on mobile, wraps to multiple rows from `md:` up.
 * Inactive categories are never offered here — same rule the admin
 * category CRUD documents ("stops appearing in public/dashboard filters").
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { getMentorCategoryLabel } from '@/lib/mentor-categories';
import type { MentorCategoryRecord } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

interface CategoryFilterBarProps {
  categories: MentorCategoryRecord[];
  selected: string[];
  onChange: (ids: string[]) => void;
  locale: Locale;
}

export function CategoryFilterBar({ categories, selected, onChange, locale }: CategoryFilterBarProps) {
  const t = useTranslations('mentors.directory');
  const active = categories.filter((c) => c.active);
  const allSelected = selected.length === 0;

  if (active.length === 0) return null;

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div
      role="group"
      aria-label={t('filterByCategory')}
      className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-x-visible"
    >
      <Chip active={allSelected} label={t('allCategories')} onClick={() => onChange([])} />
      {active.map((c) => (
        <Chip
          key={c.id}
          active={selected.includes(c.id)}
          label={getMentorCategoryLabel(c, locale)}
          onClick={() => toggle(c.id)}
        />
      ))}
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full border px-3.5 py-2 text-sm font-medium transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        active
          ? 'border-primary bg-primary/[0.07] text-primary shadow-sm'
          : 'border-border bg-background text-muted-foreground hover:border-foreground/20 hover:bg-muted/40 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}
