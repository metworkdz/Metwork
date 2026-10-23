'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** Matching on/off — in the cofounder tab and in settings. Off removes the profile from every deck. */
export function CofounderSwitch({ initial, onChange }: { initial: boolean; onChange?: (enabled: boolean) => void }) {
  const t = useTranslations('cofounder');
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const res = await fetch('/api/cofounder/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !enabled }) });
    setBusy(false);
    if (!res.ok) return;
    setEnabled(!enabled);
    onChange?.(!enabled);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 sm:p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{enabled ? t('onTitle') : t('offTitle')}</p>
        <p className="text-xs text-muted-foreground">{enabled ? t('onBody') : t('offBody')}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={t('toggle')}
        disabled={busy}
        onClick={() => void toggle()}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', enabled ? 'bg-primary' : 'bg-muted-foreground/30')}
      >
        <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', enabled ? 'start-[1.375rem]' : 'start-0.5')} />
      </button>
    </div>
  );
}
