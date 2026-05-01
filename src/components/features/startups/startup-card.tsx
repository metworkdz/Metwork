import { ArrowRight } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { StartupListing } from '@/types/startup';

function formatDZD(amount: number): string {
  return new Intl.NumberFormat('fr-DZ', {
    style: 'currency',
    currency: 'DZD',
    maximumFractionDigits: 0,
  }).format(amount);
}

interface StartupCardProps {
  startup: StartupListing;
}

export function StartupCard({ startup }: StartupCardProps) {
  return (
    <Link href={`/investors/${startup.id}`} className="group block h-full">
      <Card className="flex h-full flex-col border-border/60 transition-all group-hover:-translate-y-0.5 group-hover:border-primary-200 group-hover:shadow-md">
        <CardContent className="flex flex-1 flex-col p-6">
          {/* Industry */}
          <Badge variant="default" className="w-fit text-xs font-medium">
            {startup.industry}
          </Badge>

          {/* Name + description */}
          <h3 className="mt-3 line-clamp-1 text-lg font-semibold tracking-tight text-foreground">
            {startup.name}
          </h3>
          <p className="mt-2 flex-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {startup.description}
          </p>

          {/* Metrics */}
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border/60 pt-4">
            <div>
              <p className="text-xs text-muted-foreground">Funding goal</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {formatDZD(startup.fundingGoal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Equity offered</p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                {startup.equityOffered}%
              </p>
            </div>
          </div>

          {/* CTA hint */}
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary-600">
            View details
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
