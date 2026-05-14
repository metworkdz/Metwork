'use client';

/**
 * ImageUploadField — inline image picker that uploads to /api/incubator/upload.
 *
 * Usage:
 *   <ImageUploadField
 *     label="Cover image"
 *     currentUrl={imageUrl}
 *     onUpload={(url) => setImageUrl(url)}
 *   />
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImageIcon, Loader2, X } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

interface ImageUploadFieldProps {
  /** Label shown above the upload area. */
  label?: string;
  /** The current image URL (if one was already uploaded). */
  currentUrl?: string | null;
  /** Called with the new URL after a successful upload. */
  onUpload: (url: string) => void;
  /** Called when the user removes the image (clears the field). */
  onRemove?: () => void;
  /** Hint text shown below the upload area. */
  hint?: string;
  /** Max allowed file size in bytes (default: 5 MB). */
  maxBytes?: number;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';
const DEFAULT_MAX = 5 * 1024 * 1024; // 5 MB

export function ImageUploadField({
  label = 'Image',
  currentUrl,
  onUpload,
  onRemove,
  hint = 'JPG, PNG, WebP or GIF — max 5 MB',
  maxBytes = DEFAULT_MAX,
}: ImageUploadFieldProps) {
  const t = useTranslations('common');
  const inputRef   = useRef<HTMLInputElement>(null);
  const [preview,   setPreview]   = useState<string | null>(currentUrl ?? null);
  const [uploading, setUploading] = useState(false);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  async function handleFile(file: File) {
    if (file.size > maxBytes) {
      setErrMsg(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setErrMsg('Only image files are allowed.');
      return;
    }

    setUploading(true);
    setErrMsg(null);

    // Show a local preview immediately
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/incubator/upload', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });

      if (!res.ok) {
        setPreview(currentUrl ?? null);
        const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setErrMsg(data.error?.message ?? 'Upload failed. Please try again.');
        URL.revokeObjectURL(objectUrl);
        return;
      }

      const data = await res.json() as { url: string };
      setPreview(data.url);
      URL.revokeObjectURL(objectUrl);
      onUpload(data.url);
    } catch {
      setPreview(currentUrl ?? null);
      setErrMsg('Network error — could not upload the image.');
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    setPreview(null);
    setErrMsg(null);
    if (inputRef.current) inputRef.current.value = '';
    onRemove?.();
  }

  return (
    <div className="space-y-1.5">
      {label && <Label>{label}</Label>}

      {preview ? (
        /* ── Preview thumbnail ── */
        <div className="relative w-full overflow-hidden rounded-lg border border-border/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt={t('preview')}
            className="h-36 w-full object-cover"
          />
          {/* Overlay buttons */}
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 opacity-0 transition-opacity hover:opacity-100">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="text-xs"
            >
              {uploading ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="size-3 animate-spin" />
                  Uploading…
                </span>
              ) : (
                'Change'
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={handleRemove}
              disabled={uploading}
              className="text-xs"
            >
              <X className="size-3" />
              Remove
            </Button>
          </div>

          {/* Uploading spinner overlay */}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Loader2 className="size-6 animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        /* ── Empty drop zone ── */
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border/60 bg-muted/20 px-4 py-6 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <ImageIcon className="size-6" />
          )}
          <span className="text-xs">
            {uploading ? 'Uploading…' : 'Click to upload an image'}
          </span>
        </button>
      )}

      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />

      {/* Hint and error */}
      {errMsg ? (
        <p className="text-xs text-destructive">{errMsg}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
