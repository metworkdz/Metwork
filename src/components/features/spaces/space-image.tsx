/**
 * Image placeholder for space cards. When `imageUrl` is null we render a
 * tasteful category-tinted gradient with the matching icon — this keeps
 * the catalog visually consistent without depending on third-party
 * image hosts (which are restricted in `next.config.mjs`).
 *
 * When real images land, swap the placeholder branch for `<Image src=...>`.
 */
import { Briefcase, Building2, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SpaceCategory } from '@/types/domain';

const palette: Record<SpaceCategory, { gradient: string; iconBg: string; icon: typeof Building2 }> = {
  COWORKING: {
    gradient: 'from-sky-100 via-sky-50 to-cyan-100',
    iconBg: 'bg-sky-500/10 text-sky-700',
    icon: Building2,
  },
  PRIVATE_OFFICE: {
    gradient: 'from-emerald-100 via-emerald-50 to-teal-100',
    iconBg: 'bg-emerald-500/10 text-emerald-700',
    icon: Briefcase,
  },
  TRAINING_ROOM: {
    gradient: 'from-amber-100 via-amber-50 to-orange-100',
    iconBg: 'bg-amber-500/10 text-amber-700',
    icon: GraduationCap,
  },
  DOMICILIATION: {
    gradient: 'from-violet-100 via-violet-50 to-purple-100',
    iconBg: 'bg-violet-500/10 text-violet-700',
    icon: MapPin,
  },
};

interface SpaceImageProps {
  category: SpaceCategory;
  imageUrl: string | null;
  alt: string;
  className?: string;
  /** Compact variant used inside the detail sheet thumbnail. */
  variant?: 'default' | 'compact';
}

export function SpaceImage({ category, imageUrl, alt, className, variant = 'default' }: SpaceImageProps) {
  const cfg = palette[category];
  const Icon = cfg.icon;

  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={alt} className={cn('size-full object-cover', className)} />;
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        'relative isolate flex items-center justify-center overflow-hidden bg-gradient-to-br',
        cfg.gradient,
        className,
      )}
    >
      {/* subtle dot pattern */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 [background-image:radial-gradient(circle_at_1px_1px,_rgba(15,23,42,0.18)_1px,_transparent_0)] [background-size:18px_18px]"
      />
      <div
        className={cn(
          'relative z-10 flex items-center justify-center rounded-full ring-1 ring-inset ring-white/40 backdrop-blur-sm',
          cfg.iconBg,
          variant === 'compact' ? 'size-10' : 'size-16',
        )}
      >
        <Icon className={variant === 'compact' ? 'size-5' : 'size-7'} />
      </div>
      <div
        aria-hidden
        className="absolute end-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-foreground shadow-sm backdrop-blur-sm"
      >
        <Sparkles className="size-3" />
        {variant === 'compact' ? null : 'Verified host'}
      </div>
    </div>
  );
}
