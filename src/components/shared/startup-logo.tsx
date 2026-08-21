/**
 * StartupLogo — canonical rounded-avatar renderer for a startup listing's
 * logo, used everywhere a listing is displayed (marketplace card, detail
 * pages, public marketing cards). Falls back to initials on a brand-tinted
 * background when `logoUrl` is null — never a broken image icon, never an
 * empty gap.
 *
 * Fixed square dimensions (size prop) keep non-square uploads from
 * distorting and keep the fallback the same footprint as the image, so
 * swapping between the two causes no layout shift.
 */
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface StartupLogoProps {
  logoUrl?: string | null;
  /** Startup name — used for alt text and to derive the initials fallback. */
  name: string;
  /** Square size in pixels. Default: 40. */
  size?: number;
  className?: string;
}

function initialsFrom(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return initials || '?';
}

export function StartupLogo({ logoUrl, name, size = 40, className }: StartupLogoProps) {
  if (logoUrl) {
    return (
      <span
        className={cn('relative inline-block shrink-0 overflow-hidden rounded-full bg-muted', className)}
        style={{ width: size, height: size }}
      >
        <Image
          src={logoUrl}
          alt={name}
          fill
          sizes={`${size}px`}
          className="rounded-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700',
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsFrom(name)}
    </span>
  );
}
