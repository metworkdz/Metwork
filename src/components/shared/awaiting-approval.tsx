/**
 * Blocking "waiting for account approval" state. Presentational + server-safe
 * (no hooks) so it can be rendered directly from a server layout/page. The
 * caller passes already-translated strings.
 */
import { Clock } from 'lucide-react';

interface AwaitingApprovalProps {
  title: string;
  description: string;
  /** Optional admin rejection reason / extra note. */
  reasonLabel?: string;
  reason?: string | null;
}

export function AwaitingApproval({ title, description, reasonLabel, reason }: AwaitingApprovalProps) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Clock className="size-7" />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        {reason?.trim() ? (
          <div className="mt-4 rounded-lg border border-border bg-muted/40 p-3 text-start">
            {reasonLabel ? (
              <p className="text-xs font-semibold text-muted-foreground">{reasonLabel}</p>
            ) : null}
            <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{reason}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
