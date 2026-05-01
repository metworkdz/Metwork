'use client';

/**
 * Horizontal mentor carousel for the landing page.
 *
 * Implementation notes:
 *   - Pure CSS scroll-snap (`snap-x snap-mandatory`) on the track, so
 *     touch swiping on mobile works out of the box.
 *   - Prev / next buttons scroll the track by one full visible width,
 *     which clamps to roughly one card on mobile, two on tablet, four
 *     on desktop. The buttons disable themselves at the edges.
 *   - `useEffect` watches the scroll container so edge state updates
 *     while the user drags as well as when they click the buttons.
 *   - Native scrollbar hidden via inline style; the snap behavior is
 *     all the user needs visually.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingMentorCard } from './landing-mentor-card';
import { cn } from '@/lib/utils';
import type { Mentor } from '@/types/mentor';

interface MentorsCarouselProps {
  mentors: Mentor[];
}

export function MentorsCarousel({ mentors }: MentorsCarouselProps) {
  const trackRef = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState<{ atStart: boolean; atEnd: boolean }>({
    atStart: true,
    atEnd: false,
  });

  const sync = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    // 1px tolerance for sub-pixel drift / RTL where scrollLeft sign flips.
    const max = el.scrollWidth - el.clientWidth;
    const x = Math.abs(el.scrollLeft);
    setEdges({ atStart: x <= 1, atEnd: x >= max - 1 });
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [sync]);

  function scrollByAmount(direction: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    // Scroll by the visible width minus a small overlap, so snap aligns
    // the next card to the edge.
    const delta = direction * (el.clientWidth - 40);
    el.scrollBy({ left: delta, behavior: 'smooth' });
  }

  if (mentors.length === 0) return null;

  return (
    <div className="relative">
      {/* Edge fades — purely decorative, hint at more content. RTL-safe. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-0 z-10 w-12 bg-gradient-to-r from-background to-transparent rtl:bg-gradient-to-l"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 end-0 z-10 w-12 bg-gradient-to-l from-background to-transparent rtl:bg-gradient-to-r"
      />

      <ul
        ref={trackRef}
        role="list"
        className={cn(
          'flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth pb-4 ps-1 pe-1',
          // Hide the native scrollbar — the snap behavior is the indicator.
          '[scrollbar-width:none] [-ms-overflow-style:none]',
          '[&::-webkit-scrollbar]:hidden',
        )}
      >
        {mentors.map((m) => (
          <li
            key={m.id}
            className="snap-start shrink-0 basis-[78%] sm:basis-[42%] md:basis-[30%] lg:basis-[23%] xl:basis-[19%]"
          >
            <LandingMentorCard mentor={m} />
          </li>
        ))}
      </ul>

      {/* Prev / next */}
      <div className="mt-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {mentors.length} mentor{mentors.length === 1 ? '' : 's'} · drag, swipe, or use the arrows
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => scrollByAmount(-1)}
            disabled={edges.atStart}
            aria-label="Previous mentors"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => scrollByAmount(1)}
            disabled={edges.atEnd}
            aria-label="Next mentors"
          >
            <ChevronRight className="size-4 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}
