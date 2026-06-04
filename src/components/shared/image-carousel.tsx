'use client';

/**
 * ImageCarousel — simple gallery for public detail pages.
 *
 * One image at a time inside a framed, 16:9 container. Arrows on desktop,
 * swipe on touch, dot indicators + a photo counter. With a single image it
 * degrades to a plain framed <img> (no controls), so single-image listings
 * look exactly as they did before.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageCarouselProps {
  images: string[];
  alt: string;
  className?: string;
}

const SWIPE_THRESHOLD = 40; // px

export function ImageCarousel({ images, alt, className }: ImageCarouselProps) {
  const t = useTranslations('common');
  const [idx, setIdx] = useState(0);
  const touchStartX = useRef<number | null>(null);

  const count = images.length;
  const multiple = count > 1;
  const current = Math.min(idx, count - 1);

  function go(delta: number) {
    setIdx((i) => (i + delta + count) % count);
  }

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (touchStartX.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    if (Math.abs(dx) > SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
    touchStartX.current = null;
  }

  return (
    <div
      className={cn(
        'relative aspect-video overflow-hidden rounded-2xl border border-border bg-muted',
        className,
      )}
      onTouchStart={multiple ? onTouchStart : undefined}
      onTouchEnd={multiple ? onTouchEnd : undefined}
      onKeyDown={
        multiple
          ? (e) => {
              if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
              if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
            }
          : undefined
      }
      tabIndex={multiple ? 0 : undefined}
      role={multiple ? 'group' : undefined}
      aria-roledescription={multiple ? 'carousel' : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={images[current]}
        alt={count > 1 ? `${alt} (${current + 1}/${count})` : alt}
        className="size-full object-cover"
      />

      {multiple && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t('previousImage')}
            className="absolute start-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ChevronLeft className="size-5 rtl:rotate-180" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t('nextImage')}
            className="absolute end-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <ChevronRight className="size-5 rtl:rotate-180" />
          </button>

          {/* Counter */}
          <span className="absolute end-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {current + 1} / {count}
          </span>

          {/* Dots */}
          <div className="absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
            {images.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`${i + 1} / ${count}`}
                aria-current={i === current}
                className={cn(
                  'size-1.5 rounded-full transition-all',
                  i === current ? 'w-4 bg-white' : 'bg-white/55 hover:bg-white/80',
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
