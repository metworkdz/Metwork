import { Container } from '@/components/ui/container';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional right-side content like filters or CTAs */
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, action, className }: PageHeaderProps) {
  return (
    <section className={cn('border-b border-border/60 bg-muted/20 py-8 sm:py-12 lg:py-16', className)}>
      <Container>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-3 text-balance text-base leading-relaxed text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>
      </Container>
    </section>
  );
}
