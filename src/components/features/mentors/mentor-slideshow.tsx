'use client';

/**
 * Full-page mentor slideshow for /mentors.
 * - Large hero card per mentor with photo, name, position
 * - "Book consultation" button appears on card hover
 * - Prev / next arrows + dot indicators
 * - Auto-advances every 6 s, pauses while hovered
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Linkedin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BookConsultationDialog } from './book-consultation-dialog';
import type { Mentor } from '@/types/mentor';

interface MentorSlideshowProps {
  mentors: Mentor[];
}

export function MentorSlideshow({ mentors }: MentorSlideshowProps) {
  const [current,  setCurrent]  = useState(0);
  const [hovered,  setHovered]  = useState(false);
  const [booking,  setBooking]  = useState<Mentor | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const total = mentors.length;

  const goTo = useCallback((idx: number) => {
    setCurrent(((idx % total) + total) % total);
  }, [total]);

  const prev = useCallback(() => goTo(current - 1), [current, goTo]);
  const next = useCallback(() => goTo(current + 1), [current, goTo]);

  // Auto-advance
  useEffect(() => {
    if (hovered || total <= 1) return;
    timerRef.current = setTimeout(next, 6000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [current, hovered, next, total]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft')  prev();
      if (e.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next]);

  if (total === 0) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground">
        No mentors listed yet. Check back soon.
      </p>
    );
  }

  const mentor = mentors[current]!;

  return (
    <>
      <div
        className="relative select-none"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* ── Slide card ── */}
        <div className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-3xl shadow-2xl">
          {/* Aspect-ratio container */}
          <div className="relative aspect-[4/5] sm:aspect-[3/4] md:aspect-[16/10]">
            {/* Photo */}
            {mentor.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={mentor.id}
                src={mentor.imageUrl}
                alt={mentor.fullName}
                className="absolute inset-0 size-full object-cover transition-opacity duration-500"
              />
            ) : (
              <div className="absolute inset-0 bg-muted" />
            )}

            {/* Dark gradient overlay — always visible at bottom */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
            />

            {/* Name + position */}
            <div className="absolute inset-x-0 bottom-0 p-4 sm:p-8">
              <p className="text-lg font-semibold text-white sm:text-2xl">
                {mentor.fullName}
              </p>
              <p className="mt-0.5 text-sm text-white/75 sm:text-base">
                {mentor.position}
              </p>

              {/* Action row — always visible */}
              <div className="mt-3 flex items-center gap-3">
                <Button
                  size="sm"
                  className="h-9 bg-white text-foreground hover:bg-white/90"
                  onClick={() => setBooking(mentor)}
                >
                  <Calendar className="size-4" />
                  Book consultation
                </Button>
                {mentor.linkedinUrl && (
                  <a
                    href={mentor.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${mentor.fullName} on LinkedIn`}
                    className="flex size-8 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-white/30"
                  >
                    <Linkedin className="size-4" />
                  </a>
                )}
              </div>
            </div>

            {/* Hover: subtle vignette pulse */}
            <div
              aria-hidden
              className={cn(
                'absolute inset-0 rounded-3xl ring-2 ring-white/20 transition-opacity duration-300',
                hovered ? 'opacity-100' : 'opacity-0',
              )}
            />
          </div>
        </div>

        {/* ── Prev / Next arrows ── */}
        {total > 1 && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label="Previous mentor"
              className={cn(
                'absolute start-2 top-1/2 -translate-y-1/2 sm:start-0 sm:-translate-x-4',
                'flex size-10 items-center justify-center rounded-full bg-background/90 shadow-lg backdrop-blur-sm sm:size-11',
                'border border-border/60 transition-all hover:scale-105 hover:bg-background',
              )}
            >
              <ChevronLeft className="size-4 rtl:rotate-180 sm:size-5" />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label="Next mentor"
              className={cn(
                'absolute end-2 top-1/2 -translate-y-1/2 sm:end-0 sm:translate-x-4',
                'flex size-10 items-center justify-center rounded-full bg-background/90 shadow-lg backdrop-blur-sm sm:size-11',
                'border border-border/60 transition-all hover:scale-105 hover:bg-background',
              )}
            >
              <ChevronRight className="size-4 rtl:rotate-180 sm:size-5" />
            </button>
          </>
        )}

        {/* ── Dot indicators ── */}
        {total > 1 && (
          <div
            role="tablist"
            aria-label="Mentor slides"
            className="mt-6 flex items-center justify-center gap-2"
          >
            {mentors.map((m, i) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={i === current}
                aria-label={`Go to ${m.fullName}`}
                onClick={() => goTo(i)}
                className={cn(
                  'rounded-full transition-all duration-300',
                  i === current
                    ? 'h-2.5 w-6 bg-primary'
                    : 'size-2 bg-muted-foreground/30 hover:bg-muted-foreground/60',
                )}
              />
            ))}
          </div>
        )}

        {/* Counter */}
        {total > 1 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {current + 1} / {total}
          </p>
        )}
      </div>

      <BookConsultationDialog
        mentor={booking}
        open={booking !== null}
        onOpenChange={(open) => { if (!open) setBooking(null); }}
      />
    </>
  );
}
