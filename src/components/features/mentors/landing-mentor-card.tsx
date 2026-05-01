/**
 * Landing-page mentor card. Square rounded image on top, name + position
 * underneath, optional LinkedIn pill on hover. Used both inside the
 * landing carousel and as the live preview in the admin form dialog.
 */
import { Linkedin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Mentor } from '@/types/mentor';

interface LandingMentorCardProps {
  mentor: Mentor;
  /** When false, the hover zoom + shadow is disabled (used inside the admin form preview). */
  hoverable?: boolean;
  className?: string;
}

export function LandingMentorCard({
  mentor,
  hoverable = true,
  className,
}: LandingMentorCardProps) {
  return (
    <article
      className={cn(
        'group relative w-full overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 ease-out',
        hoverable &&
          'hover:-translate-y-1 hover:border-foreground/20 hover:shadow-xl hover:shadow-foreground/5',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {mentor.imageUrl ? (
          // Plain <img> so any URL works without next/image domain config.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mentor.imageUrl}
            alt={mentor.fullName}
            className={cn(
              'size-full object-cover transition-transform duration-500 ease-out',
              hoverable && 'group-hover:scale-105',
            )}
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
            no image
          </div>
        )}
        {/* Bottom gradient → makes the LinkedIn pill readable on busy photos */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/35 via-black/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        />
        {mentor.linkedinUrl && (
          <a
            href={mentor.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={`${mentor.fullName} on LinkedIn`}
            className={cn(
              'absolute end-3 bottom-3 inline-flex items-center justify-center rounded-full bg-white/95 p-2 text-foreground shadow-md transition-all duration-300 ease-out',
              'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100',
              'hover:bg-white hover:scale-105',
            )}
          >
            <Linkedin className="size-4" />
          </a>
        )}
      </div>

      <div className="p-4">
        <p className="line-clamp-1 text-sm font-semibold tracking-tight text-foreground">
          {mentor.fullName}
        </p>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {mentor.position}
        </p>
      </div>
    </article>
  );
}
