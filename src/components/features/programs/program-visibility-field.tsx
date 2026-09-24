'use client';

/**
 * Public or unlisted — the choice at the end of the program form, shared by
 * the incubator dashboard and the consultant portal so both ask it the same
 * way.
 */
import { useTranslations } from 'next-intl';
import { Globe, Link2 } from 'lucide-react';

import type { ProgramVisibility } from '@/lib/program-form';
import { cn } from '@/lib/utils';

export function ProgramVisibilityField({
  value,
  onChange,
}: {
  value: ProgramVisibility;
  onChange: (v: ProgramVisibility) => void;
}) {
  const t = useTranslations('programVisibility');
  const options = [
    { id: 'PUBLIC' as const, Icon: Globe, title: t('publicTitle'), body: t('publicBody') },
    { id: 'UNLISTED' as const, Icon: Link2, title: t('unlistedTitle'), body: t('unlistedBody') },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{t('label')}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ id, Icon, title, body }) => {
          const on = value === id;
          return (
            <label
              key={id}
              htmlFor={`program-visibility-${id}`}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors',
                on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40',
              )}
            >
              <input
                id={`program-visibility-${id}`}
                type="radio"
                name="program-visibility"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                aria-label={title}
                aria-describedby={`program-visibility-${id}-body`}
                checked={on}
                onChange={() => onChange(id)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {title}
                </span>
                <span id={`program-visibility-${id}-body`} className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{body}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </fieldset>
  );
}
