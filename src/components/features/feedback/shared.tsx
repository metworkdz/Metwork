/**
 * Small pieces shared by the host's « Avis » views — and by the server-rendered
 * « Avis » overview page, so nothing here may use hooks or browser APIs.
 */
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export type FeedbackApiBase = '/api/incubator/programs' | '/api/consultant/programs';

/** Read the `{ error: { message } }` envelope, or fall back. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

/** A rating drawn as stars — 4.3 fills four stars and a third of the fifth. */
export function StarsDisplay({ value, className }: { value: number | null; className?: string }) {
  const v = value ?? 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)} dir="ltr" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = Math.max(0, Math.min(1, v - i));
        return (
          <span key={i} className="relative inline-block size-[1em]">
            <Star className="absolute inset-0 size-[1em] text-zinc-300 dark:text-zinc-600" strokeWidth={1.5} />
            <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
              <Star className="size-[1em] fill-amber-400 text-amber-400" strokeWidth={1.5} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** « 4,3 » in French and Arabic, « 4.3 » in English. */
export function formatRating(value: number, locale: string): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : locale === 'ar' ? 'ar-DZ' : 'fr-FR', {
    minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(value);
}
