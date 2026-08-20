import type { LucideIcon } from 'lucide-react';

/**
 * Empty state for modules whose UI lands in a later prompt.
 *
 * Every nav entry resolves to a real page — nothing 404s (Prompt 1 brief). The
 * database tables behind these modules already exist from the Prompt 1 schema
 * pass, so later prompts add application code only, never migrations.
 */
export function ComingSoon({
  title,
  description,
  icon: Icon,
  prompt,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  prompt?: number;
}) {
  return (
    <div className="flex min-h-[24rem] flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white/60 px-6 py-16 text-center">
      {Icon ? (
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-neutral-100">
          <Icon className="size-6 text-neutral-400" aria-hidden />
        </div>
      ) : null}
      <h2 className="text-base font-semibold text-[var(--crm-black)]">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-neutral-500">
        {description ?? 'Ce module arrive dans une prochaine étape.'}
      </p>
      <span className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500">
        <span className="size-1.5 rounded-full bg-[var(--crm-green)]" aria-hidden />
        Bientôt disponible{prompt ? ` — étape ${prompt}` : ''}
      </span>
    </div>
  );
}
