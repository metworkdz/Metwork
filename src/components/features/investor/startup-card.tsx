/**
 * Marketplace card displaying a startup to potential investors.
 * Pure presentation — investors take action via the parent's callbacks.
 */
import { Building2, MapPin, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/format';
import type { Startup } from '@/types/domain';
import type { Locale } from '@/i18n/config';

const stageLabels: Record<Startup['stage'], string> = {
  IDEA: 'Idea',
  PRE_SEED: 'Pre-seed',
  SEED: 'Seed',
  SERIES_A: 'Series A',
  GROWTH: 'Growth',
};

interface StartupCardProps {
  startup: Startup;
  locale: Locale;
  onRequestMeeting?: (startupId: string) => void;
}

export function StartupCard({ startup, locale, onRequestMeeting }: StartupCardProps) {
  return (
    <Card className="flex flex-col transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-md">
      <CardContent className="flex-1 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-11 items-center justify-center rounded-md bg-primary-50 text-primary-700">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold">{startup.name}</h3>
            <p className="text-xs text-muted-foreground">by {startup.founderName}</p>
          </div>
          <Badge variant="primary">{stageLabels[startup.stage]}</Badge>
        </div>

        <p className="mt-4 line-clamp-2 text-sm font-medium text-foreground">
          {startup.tagline}
        </p>
        <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
          {startup.pitch}
        </p>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Sector</dt>
            <dd className="mt-0.5 font-medium">{startup.sector}</dd>
          </div>
          <div>
            <dt className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              City
            </dt>
            <dd className="mt-0.5 font-medium">{startup.city}</dd>
          </div>
          <div>
            <dt className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="size-3" />
              Asking
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums">
              {formatCurrency(startup.fundingAsk, locale)}
            </dd>
          </div>
          {startup.valuation != null && (
            <div>
              <dt className="text-xs text-muted-foreground">Valuation</dt>
              <dd className="mt-0.5 font-medium tabular-nums">
                {formatCurrency(startup.valuation, locale)}
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
      <CardFooter className="border-t border-border/60 px-6 py-4">
        <Button
          type="button"
          size="sm"
          className="w-full"
          onClick={() => onRequestMeeting?.(startup.id)}
        >
          Request meeting
        </Button>
      </CardFooter>
    </Card>
  );
}
