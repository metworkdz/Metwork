import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { siteConfig } from '@/config/site';
import { cn } from '@/lib/utils';

/** Natural aspect ratio of metworklogo.svg (viewBox 222.6 × 36.34) */
const LOGO_ASPECT = 222.6 / 36.34; // ≈ 6.13

interface LogoProps {
  className?: string;
  /**
   * Show a text wordmark beside the image.
   * Defaults to false — the SVG already contains the full wordmark.
   */
  showWordmark?: boolean;
  /** Pixel height — width auto-scales via CSS */
  size?: number;
}

export function Logo({ className, showWordmark = false, size = 32 }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn(
        'inline-flex items-center gap-2 transition-opacity hover:opacity-80',
        className,
      )}
      aria-label={siteConfig.name}
    >
      <Image
        src={siteConfig.logo}
        alt={siteConfig.name}
        width={Math.round(size * LOGO_ASPECT)}
        height={size}
        priority
        className="h-8 w-auto"
      />
      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight text-foreground">
          {siteConfig.name}
        </span>
      )}
    </Link>
  );
}
