/**
 * Marketplace card for a single space. Click anywhere on the card → opens
 * the detail sheet on the parent (see `SpacesExplorer`).
 */
import { MapPin, Star } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SpaceImage } from './space-image';
import { categoryLabel } from './space-meta';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { Space } from '@/types/domain';

interface SpaceCardProps {
  space: Space;
  locale: Locale;
  onSelect: (space: Space) => void;
}

function startingPrice(space: Space): { amount: number; suffix: string } | null {
  if (space.pricePerHour != null) return { amount: space.pricePerHour, suffix: '/hour' };
  if (space.pricePerDay != null) return { amount: space.pricePerDay, suffix: '/day' };
  if (space.pricePerMonth != null) return { amount: space.pricePerMonth, suffix: '/month' };
  return null;
}

export function SpaceCard({ space, locale, onSelect }: SpaceCardProps) {
  const price = startingPrice(space);
  return (
    <Card
      role="article"
      tabIndex={0}
      onClick={() => onSelect(space)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(space);
        }
      }}
      className={cn(
        'group flex cursor-pointer flex-col overflow-hidden p-0 transition-all',
        'hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-lg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <div className="relative aspect-[16/10] w-full">
        <SpaceImage category={space.category} imageUrl={space.imageUrl} alt={space.name} />
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <Badge variant="outline">{categoryLabel[space.category]}</Badge>
          {space.rating != null && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Star className="size-3 fill-amber-400 stroke-amber-400" />
              <span className="font-medium text-foreground">{space.rating.toFixed(1)}</span>
              <span>({space.reviewCount})</span>
            </span>
          )}
        </div>

        <h3 className="mt-3 line-clamp-1 text-base font-semibold text-foreground">
          {space.name}
        </h3>
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          {space.city} · {space.incubatorName}
        </p>

        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {space.description}
        </p>

        <div className="mt-auto flex items-end justify-between pt-5">
          {price ? (
            <div>
              <p className="text-xs text-muted-foreground">From</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatCurrency(price.amount, locale)}
                <span className="ms-1 text-xs font-normal text-muted-foreground">
                  {price.suffix}
                </span>
              </p>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Contact for pricing</span>
          )}
          <span className="text-xs font-medium text-primary-700 group-hover:underline">
            View details →
          </span>
        </div>
      </div>
    </Card>
  );
}
