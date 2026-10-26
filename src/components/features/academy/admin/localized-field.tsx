'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { withTranslation, localizedText, type LocalizedText } from '@/lib/localized-text';
import type { Locale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/** Write `value` in `lang` into a text that may not exist yet (it then starts in that language). */
export function setLocalized(t: LocalizedText | null, lang: Locale, value: string): LocalizedText {
  if (!t) return localizedText(lang, value);
  return withTranslation(t, lang, value);
}

interface LocalizedFieldProps {
  id: string;
  value: LocalizedText | null;
  lang: Locale;
  onChange: (next: LocalizedText | null) => void;
  multiline?: boolean;
  maxLength: number;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
}

/**
 * One input for one language of a translated text. Shows the original as a
 * hint when editing a translation, and flags machine-drafted translations.
 */
export function LocalizedField({ id, value, lang, onChange, multiline, maxLength, placeholder, className, ...rest }: LocalizedFieldProps) {
  const t = useTranslations('academyAdmin.localized');
  const current = value?.[lang] ?? '';
  const isSource = !value || value.source === lang;
  const drafted = Boolean(value?.drafted?.includes(lang));
  const original = value && !isSource ? value[value.source] ?? '' : '';
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  const handle = (v: string) => {
    if (!value && !v.trim()) return onChange(null);
    onChange(setLocalized(value, lang, v));
  };

  const common = {
    id,
    dir,
    value: current,
    maxLength,
    placeholder: original || placeholder,
    'aria-label': rest['aria-label'],
    className: cn(drafted && 'border-amber-400 dark:border-amber-500', className),
  };

  return (
    <div className="space-y-1">
      {multiline
        ? <Textarea {...common} rows={5} onChange={(e) => handle(e.target.value)} />
        : <Input {...common} onChange={(e) => handle(e.target.value)} />}
      {(drafted || (!isSource && !current)) && (
        <p className={cn('text-xs', drafted ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
          {drafted ? t('drafted') : t('missing')}
        </p>
      )}
    </div>
  );
}
