'use client';

/**
 * Lightweight tooltip built without a Radix dependency.
 * Uses CSS :hover visibility — no JS needed for simple cases.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

interface TooltipProviderProps { children: React.ReactNode; delayDuration?: number }
function TooltipProvider({ children }: TooltipProviderProps) { return <>{children}</>; }

interface TooltipContextValue { open: boolean; setOpen: (v: boolean) => void }
const TooltipContext = React.createContext<TooltipContextValue>({ open: false, setOpen: () => {} });

function Tooltip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <span className="relative inline-flex">{children}</span>
    </TooltipContext.Provider>
  );
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: { asChild?: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLSpanElement>) {
  const { setOpen } = React.useContext(TooltipContext);
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
      onFocus: () => setOpen(true),
      onBlur: () => setOpen(false),
    });
  }
  return (
    <span
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      {...props}
    >
      {children}
    </span>
  );
}

const TooltipContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const { open } = React.useContext(TooltipContext);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className={cn(
        'absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md whitespace-nowrap',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TooltipContent.displayName = 'TooltipContent';

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
