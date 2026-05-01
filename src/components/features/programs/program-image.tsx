/**
 * Type-tinted gradient image placeholder for program cards. When real
 * images land, swap the placeholder branch for `<Image>`.
 */
import { Briefcase, Compass, Flame, GraduationCap, Hammer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { programTypeTint } from './program-meta';
import type { ProgramType } from '@/types/domain';

const iconFor: Record<ProgramType, typeof Briefcase> = {
  ACCELERATION: Flame,
  INCUBATION: Compass,
  BOOTCAMP: Hammer,
  TRAINING: GraduationCap,
  WORKSHOP: Briefcase,
};

interface ProgramImageProps {
  type: ProgramType;
  imageUrl: string | null;
  alt: string;
  className?: string;
  variant?: 'default' | 'compact';
}

export function ProgramImage({ type, imageUrl, alt, className, variant = 'default' }: ProgramImageProps) {
  const Icon = iconFor[type];
  const tint = programTypeTint[type];

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
        tint.gradient,
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-25 [background-image:linear-gradient(45deg,_rgba(15,23,42,0.10)_25%,_transparent_25%,_transparent_50%,_rgba(15,23,42,0.10)_50%,_rgba(15,23,42,0.10)_75%,_transparent_75%)] [background-size:22px_22px]"
      />
      <div
        className={cn(
          'relative z-10 flex items-center justify-center rounded-full ring-1 ring-inset ring-white/40 backdrop-blur-sm',
          tint.iconBg,
          variant === 'compact' ? 'size-10' : 'size-16',
        )}
      >
        <Icon className={variant === 'compact' ? 'size-5' : 'size-7'} />
      </div>
    </div>
  );
}
