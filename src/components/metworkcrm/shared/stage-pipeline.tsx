'use client';

/**
 * A horizontal stepper for a linear stage pipeline (OI Projects: 10 stages,
 * Programs: 8). Deliberately NOT drag-and-drop Kanban columns: a 10-column
 * board needs horizontal scroll on both desktop and 375px, and the CRM brief
 * bans `useMediaQuery`-driven layout branching — a `flex-wrap` row of pills
 * degrades on Tailwind breakpoints alone. Clicking any stage does an
 * optimistic PATCH, same pattern as every list's inline stage `<select>`.
 */
import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StagePipeline({
  stages,
  labels,
  current,
  onChange,
  disabled,
}: {
  stages: readonly string[];
  labels: Record<string, string>;
  current: string;
  onChange: (next: string) => Promise<void> | void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const currentIndex = stages.indexOf(current);

  async function jumpTo(stage: string) {
    if (stage === current || disabled || pending) return;
    setPending(stage);
    try {
      await onChange(stage);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Étapes du pipeline">
      {stages.map((stage, i) => {
        const isCurrent = stage === current;
        const isPast = currentIndex >= 0 && i < currentIndex;
        return (
          <button
            key={stage}
            type="button"
            role="listitem"
            disabled={disabled}
            onClick={() => jumpTo(stage)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              isCurrent
                ? 'border-[var(--crm-green)] bg-[var(--crm-green)] text-white'
                : isPast
                  ? 'border-[var(--crm-green)]/30 bg-[var(--crm-green)]/10 text-[var(--crm-green)] hover:bg-[var(--crm-green)]/20'
                  : 'border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50',
            )}
          >
            {isPast ? <Check className="size-3" aria-hidden /> : null}
            {pending === stage ? '…' : labels[stage] ?? stage}
          </button>
        );
      })}
    </div>
  );
}
