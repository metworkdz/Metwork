/**
 * METWORK OS CRM — button.
 *
 * A local copy rather than a reuse of `@/components/ui/button`, for one narrow
 * reason: that component's hover/active states use `bg-primary-700` /
 * `bg-primary-800`, which are FIXED hsl() values in tailwind.config.ts, not CSS
 * variables — so the `[data-crm]` token override cannot reach them and the
 * hover state would render in the platform's green instead of #30a735.
 *
 * Token-driven primitives (input, label, card, table, dialog) do NOT have this
 * problem and are reused from `@/components/ui/*` unchanged.
 */
'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const crmButtonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-green)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--crm-green)] text-white hover:bg-[var(--crm-green-hover)] active:bg-[var(--crm-green-active)]',
        outline:
          'border border-neutral-300 bg-white text-[var(--crm-black)] hover:bg-neutral-50 active:bg-neutral-100',
        ghost: 'text-[var(--crm-black)] hover:bg-neutral-100 active:bg-neutral-200',
        destructive: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
        subtle: 'bg-neutral-900 text-white hover:bg-neutral-800 active:bg-neutral-700',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3 text-xs',
        lg: 'h-11 px-6',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface CrmButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof crmButtonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const CrmButton = React.forwardRef<HTMLButtonElement, CrmButtonProps>(
  ({ className, variant, size, asChild = false, loading, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(crmButtonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
CrmButton.displayName = 'CrmButton';

export { crmButtonVariants };
