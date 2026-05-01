/**
 * Compact empty state designed to live inside cards / table containers.
 * The bigger `EmptyState` from `components/shared` is sized for full-page
 * empties on marketing routes.
 */
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InlineEmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function InlineEmptyState({
  title,
  description,
  icon,
  action,
  className,
}: InlineEmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        {icon ?? <Inbox className="size-5 text-muted-foreground" />}
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
