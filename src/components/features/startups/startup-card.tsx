import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LockedNotice } from '@/components/features/startups/locked-notice';
import type { PublicStartupListing } from '@/types/startup';

interface StartupCardProps {
  startup: PublicStartupListing;
}

/**
 * Public-only startup card — used on marketing pages, never authenticated
 * dashboards. Renders the redacted DECISION FLAG 2 view: no funding amount,
 * equity, valuation, full pitch, or founder contact.
 */
export function StartupCard({ startup }: StartupCardProps) {
  const t = useTranslations('startup.profileForm');
  const tp = useTranslations('pages.startups');

  return (
    <Link href={`/investors/${startup.id}`} className="group block h-full">
      <Card className="flex h-full flex-col border-border/60 transition-all group-hover:-translate-y-0.5 group-hover:border-primary-200 group-hover:shadow-md">
        <CardContent className="flex flex-1 flex-col p-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="default" className="w-fit text-xs font-medium">
              {startup.industry}
            </Badge>
            {startup.maturityStage && (
              <Badge variant="outline" className="w-fit text-xs font-medium">
                {t(`stage${startup.maturityStage}`)}
              </Badge>
            )}
            {startup.isRaising && (
              <Badge variant="success" className="w-fit text-xs font-medium">
                {tp('raisingBadge')}
              </Badge>
            )}
          </div>

          <h3 className="mt-3 line-clamp-1 text-lg font-semibold tracking-tight text-foreground">
            {startup.name}
          </h3>
          {startup.city && (
            <p className="mt-0.5 text-xs text-muted-foreground">{startup.city}</p>
          )}
          <p className="mt-2 flex-1 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {startup.tagline}
          </p>

          <LockedNotice
            label={tp('lockedLabel')}
            cta={tp('lockedCta')}
            compact
            className="mt-5"
          />

          {/* CTA hint */}
          <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary-600">
            {tp('viewDetails')}
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
