'use client';

/**
 * AvatarUpload — click the avatar circle to pick a new photo.
 * Calls POST /api/auth/avatar and notifies the parent via onUpload(url).
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface AvatarUploadProps {
  currentUrl?: string | null;
  fallbackInitials?: string;
  onUpload: (url: string) => void;
  onError?: (message: string) => void;
  /** Size class applied to the Avatar root, e.g. "size-20". Default: "size-20" */
  size?: string;
}

export function AvatarUpload({
  currentUrl,
  fallbackInitials = '?',
  onUpload,
  onError,
  size = 'size-20',
}: AvatarUploadProps) {
  const t = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File) {
    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/auth/avatar', {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        setPreview(null);
        const err = await res.json().catch(() => ({})) as { message?: string };
        onError?.(err.message ?? 'Upload failed');
        return;
      }
      const data = await res.json() as { url: string };
      setPreview(data.url);
      onUpload(data.url);
    } catch {
      setPreview(null);
      onError?.('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  const displayUrl = preview ?? currentUrl ?? undefined;
  const initials = fallbackInitials
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="relative inline-block">
      <Avatar className={size}>
        {displayUrl && <AvatarImage src={displayUrl} alt={t('profilePicture')} />}
        <AvatarFallback>{initials || '?'}</AvatarFallback>
      </Avatar>

      {/* Overlay button */}
      <button
        type="button"
        title={t('changeProfilePicture')}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin text-white" />
        ) : (
          <Camera className="size-5 text-white" />
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        className="hidden"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
