'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 16:9 course cover, uploaded into the `academy` folder — through the generic
 * image endpoint for the admin, or the consultant upload route in the Studio.
 */
export function CoverUpload({ url, onUpload, onError, endpoint = 'admin' }: {
  url: string | null; onUpload: (url: string) => void; onError: (msg: string) => void; endpoint?: 'admin' | 'consultant';
}) {
  const t = useTranslations('academyAdmin.builder');
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function send(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (endpoint === 'consultant') fd.append('kind', 'academy-cover');
      else fd.append('folder', 'academy');
      const res = await fetch(endpoint === 'consultant' ? '/api/consultant/upload' : '/api/upload', { method: 'POST', credentials: 'include', body: fd });
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: { message?: string } };
      if (!res.ok || !data.url) return onError(data.error?.message ?? t('errors.UPLOAD_FAILED'));
      onUpload(data.url);
    } catch {
      onError(t('errors.UPLOAD_FAILED'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      disabled={busy}
      className={cn(
        'relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/40 text-sm text-muted-foreground',
        'hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      aria-label={t('changeCover')}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="absolute inset-0 size-full object-cover" />}
      <span className={cn('relative inline-flex items-center gap-2 rounded-lg px-3 py-1.5', url && 'bg-black/55 text-white')}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
        {url ? t('changeCover') : t('addCover')}
      </span>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void send(f); }} />
    </button>
  );
}
