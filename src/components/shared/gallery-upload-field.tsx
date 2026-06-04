'use client';

/**
 * GalleryUploadField — multi-image picker built on the same upload backend
 * as ImageUploadField (POST /api/incubator/upload → Cloudinary or local).
 *
 * Controlled component: the parent owns the ordered URL list.
 *   <GalleryUploadField
 *     label="Photos"
 *     value={imageUrls}
 *     onChange={setImageUrls}
 *   />
 *
 * imageUrls[0] is treated as the cover everywhere downstream, so reordering
 * the first item changes the cover.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Star, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface GalleryUploadFieldProps {
  /** Label shown above the gallery. */
  label?: string;
  /** Ordered list of uploaded image URLs. First item is the cover. */
  value: string[];
  /** Called with the new ordered list whenever images are added, reordered or removed. */
  onChange: (urls: string[]) => void;
  /** Max number of images (default: 8). */
  maxImages?: number;
  /** Hint text shown below the gallery. */
  hint?: string;
  /** Max allowed file size in bytes per image (default: 5 MB). */
  maxBytes?: number;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_MAX_IMAGES = 8;

export function GalleryUploadField({
  label,
  value,
  onChange,
  maxImages = DEFAULT_MAX_IMAGES,
  hint,
  maxBytes = DEFAULT_MAX_BYTES,
}: GalleryUploadFieldProps) {
  const t = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const remaining = Math.max(0, maxImages - value.length);
  const full = remaining === 0;

  async function uploadOne(file: File): Promise<string | null> {
    if (file.size > maxBytes) {
      setErrMsg(t('photoTooLarge', { mb: Math.round(maxBytes / 1024 / 1024) }));
      return null;
    }
    if (!file.type.startsWith('image/')) {
      setErrMsg(t('photoTypeInvalid'));
      return null;
    }
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/incubator/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setErrMsg(data.error?.message ?? t('photoUploadFailed'));
        return null;
      }
      const data = (await res.json()) as { url: string };
      return data.url;
    } catch {
      setErrMsg(t('photoNetworkError'));
      return null;
    }
  }

  async function handleFiles(fileList: FileList) {
    setErrMsg(null);
    let files = Array.from(fileList);
    if (files.length > remaining) {
      files = files.slice(0, remaining);
      setErrMsg(t('photoMaxReached', { max: maxImages }));
    }
    if (files.length === 0) return;

    setUploadingCount(files.length);
    const added: string[] = [];
    for (const file of files) {
      const url = await uploadOne(file);
      if (url) added.push(url);
    }
    setUploadingCount(0);
    if (added.length > 0) onChange([...value, ...added]);
  }

  function move(index: number, dir: -1 | 1) {
    const next = [...value];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  function setCover(index: number) {
    if (index === 0) return;
    const next = [...value];
    const [picked] = next.splice(index, 1);
    next.unshift(picked!);
    onChange(next);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1.5">
      {label && <Label>{label}</Label>}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {value.map((url, i) => (
          <div
            key={url}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-lg border bg-muted',
              i === 0 ? 'border-primary ring-1 ring-primary/40' : 'border-border/60',
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={t('preview')} className="size-full object-cover" />

            {/* Cover badge */}
            {i === 0 && (
              <span className="absolute start-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-sm">
                <Star className="size-2.5 fill-current" />
                {t('cover')}
              </span>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={t('removePhoto')}
              className="absolute end-1 top-1 inline-flex size-5 items-center justify-center rounded-full bg-black/55 text-white transition-colors hover:bg-destructive"
            >
              <X className="size-3" />
            </button>

            {/* Reorder + cover controls — always visible on touch, hover on desktop */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-gradient-to-t from-black/65 to-transparent px-1 pb-1 pt-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={t('movePhotoEarlier')}
                className="inline-flex size-5 items-center justify-center rounded bg-white/85 text-slate-800 disabled:opacity-30"
              >
                <ChevronLeft className="size-3 rtl:rotate-180" />
              </button>
              {i !== 0 && (
                <button
                  type="button"
                  onClick={() => setCover(i)}
                  aria-label={t('setCover')}
                  className="inline-flex size-5 items-center justify-center rounded bg-white/85 text-slate-800"
                >
                  <Star className="size-3" />
                </button>
              )}
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === value.length - 1}
                aria-label={t('movePhotoLater')}
                className="inline-flex size-5 items-center justify-center rounded bg-white/85 text-slate-800 disabled:opacity-30"
              >
                <ChevronRight className="size-3 rtl:rotate-180" />
              </button>
            </div>
          </div>
        ))}

        {/* Uploading placeholder tiles */}
        {Array.from({ length: uploadingCount }).map((_, i) => (
          <div
            key={`uploading-${i}`}
            className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/30"
          >
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ))}

        {/* Add tile */}
        {!full && uploadingCount === 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border/60 bg-muted/20 px-2 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <ImagePlus className="size-5" />
            <span className="text-center text-[11px] leading-tight">{t('addPhotos')}</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {errMsg ? (
        <p className="text-xs text-destructive">{errMsg}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {hint ?? t('galleryHint', { max: maxImages })}
        </p>
      )}
    </div>
  );
}
