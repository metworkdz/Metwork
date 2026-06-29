'use client';

/**
 * OfficeGallery — PRIVATE_OFFICE photo gallery.
 *
 * Large main photo + a thumbnail strip (shown only when there's more than one
 * photo). Prev/next arrows, keyboard accessible (Left/Right when focused). With
 * a single photo it degrades to a plain framed image with no controls.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  photos: string[];
  alt: string;
}

export function OfficeGallery({ photos, alt }: Props) {
  const t = useTranslations('common');
  const [idx, setIdx] = useState(0);

  const count = photos.length;

  if (count === 0) {
    return (
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted">
        <Building2 className="size-12 text-muted-foreground/30" />
      </div>
    );
  }

  const current = Math.min(idx, count - 1);
  const multiple = count > 1;
  const go = (delta: number) => setIdx((i) => (i + delta + count) % count);

  return (
    <div className="space-y-3">
      {/* Main photo */}
      <div
        className="relative aspect-video overflow-hidden rounded-2xl border border-border bg-muted"
        tabIndex={multiple ? 0 : undefined}
        role={multiple ? 'group' : undefined}
        aria-roledescription={multiple ? 'carousel' : undefined}
        onKeyDown={
          multiple
            ? (e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
              }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photos[current]}
          alt={multiple ? `${alt} (${current + 1}/${count})` : alt}
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
            <span className="absolute end-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
              {current + 1} / {count}
            </span>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      {multiple && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={`${i + 1} / ${count}`}
              aria-current={i === current}
              className={cn(
                'relative aspect-video h-14 shrink-0 overflow-hidden rounded-lg border-2 transition-colors',
                i === current ? 'border-primary' : 'border-transparent hover:border-primary/40',
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
