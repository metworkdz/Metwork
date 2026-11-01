'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';

/** The "keep going" reminder emails: on by default, one switch to turn them off. */
export function RemindersToggle({ initialOff }: { initialOff: boolean }) {
  const t = useTranslations('academy.learning.reminders');
  const [off, setOff] = useState(initialOff);
  const [busy, setBusy] = useState(false);
  return (
    <label id="reminders" className="flex scroll-mt-24 items-start gap-3 rounded-2xl border border-border p-4 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={!off} disabled={busy}
        onChange={async (e) => {
          const nextOff = !e.target.checked;
          setBusy(true);
          try { setOff((await apiClient.post<{ off: boolean }>('/academy/reminders', { off: nextOff })).off); } catch { /* unchanged */ }
          finally { setBusy(false); }
        }} />
      <span>
        <span className="block font-semibold">{t('label')}</span>
        <span className="block text-muted-foreground">{t('hint')}</span>
      </span>
    </label>
  );
}
