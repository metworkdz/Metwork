/**
 * Compact page header for use inside the dashboard chrome (sidebar +
 * topbar). The marketing-page `PageHeader` lives in components/layout
 * and is sized larger.
 */
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

interface DashboardPageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}

export function DashboardPageHeader({
  title,
  subtitle,
  action,
  className,
}: DashboardPageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex flex-shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}
