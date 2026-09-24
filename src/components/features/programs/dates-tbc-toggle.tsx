'use client';

/**
 * « Dates à confirmer » — publish a program as a pre-registration before its
 * dates are fixed. Shared by the incubator dashboard and the consultant
 * portal; the rules behind it live in `@/lib/program-dates`.
 */
import { useTranslations } from 'next-intl';

export function DatesTbcToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const t = useTranslations('programVisibility');
  return (
    <label htmlFor="program-dates-tbc" className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3">
      <input
        id="program-dates-tbc"
        type="checkbox"
        className="mt-0.5 size-4 shrink-0 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={t('datesTbcLabel')}
        aria-describedby="program-dates-tbc-hint"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{t('datesTbcLabel')}</span>
        <span id="program-dates-tbc-hint" className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          {t('datesTbcHint')}
        </span>
      </span>
    </label>
  );
}
