'use client';

/**
 * The "File upload" question on the public registration form.
 *
 * Pick (or drop) one PDF or JPG; it uploads straight away with a progress bar,
 * so the visitor finds out about a bad file on THIS screen rather than after
 * filling in the rest. The answer held by the form is the file's storage id —
 * the file itself never rides along with the submit.
 *
 * States: nothing chosen → uploading (cancellable) → attached (replace / remove).
 * A failed replacement keeps the file that was already attached; the error says
 * what happened and what to do. While a file is in flight this reports itself
 * busy, and the form blocks Continue, Back and Submit — leaving mid-upload would
 * silently drop the file.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, ImageIcon, Loader2, Paperclip, Upload, X } from 'lucide-react';
import {
  REGISTRATION_FILE_ACCEPT,
  MAX_REGISTRATION_FILE_MB,
} from '@/lib/upload-limits';
import {
  RegistrationFileUploadError,
  effectiveMime,
  formatFileSize,
  uploadRegistrationFile,
} from '@/lib/registration-file-upload';
import { cn } from '@/lib/utils';

export interface AttachedFile {
  name: string;
  size: number;
}

interface Props {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  fieldId: string;
  /** The attached file's storage id, or '' when none. */
  value: string;
  file: AttachedFile | null;
  /** A problem the form found (e.g. required and empty, or rejected on submit). */
  error?: string;
  onUploaded: (publicId: string, file: AttachedFile) => void;
  onRemove: () => void;
  onBusyChange: (busy: boolean) => void;
}

export function RegistrationFileField({
  entityType,
  entityId,
  fieldId,
  value,
  file,
  error,
  onUploaded,
  onRemove,
  onBusyChange,
}: Props) {
  const t = useTranslations('registration');
  const inputId = `q-${fieldId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState<{ name: string; size: number; progress: number } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Leaving the page (or the form finishing) cancels whatever is in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  function messageFor(err: unknown): string | null {
    if (!(err instanceof RegistrationFileUploadError)) return t('errorFileUpload');
    switch (err.code) {
      case 'TYPE': return t('errorFileType');
      case 'SIZE': return t('errorFileSize', { max: MAX_REGISTRATION_FILE_MB });
      case 'EMPTY': return t('errorFileEmpty');
      case 'NETWORK': return t('errorFileNetwork');
      case 'SERVICE': return t('errorFileService');
      case 'RATE_LIMITED': return t('errorRateLimited');
      case 'UNAVAILABLE': return t('errorFileUnavailable');
      case 'CANCELLED': return null;
      default: return t('errorFileUpload');
    }
  }

  async function start(picked: File) {
    setFailure(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading({ name: picked.name, size: picked.size, progress: 0 });
    onBusyChange(true);
    try {
      const { publicId } = await uploadRegistrationFile({
        entityType,
        entityId,
        fieldId,
        file: picked,
        signal: controller.signal,
        onProgress: (fraction) =>
          setUploading((u) => (u ? { ...u, progress: fraction } : u)),
      });
      onUploaded(publicId, { name: picked.name, size: picked.size });
    } catch (err) {
      setFailure(messageFor(err));
    } finally {
      abortRef.current = null;
      setUploading(null);
      onBusyChange(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (picked) void start(picked);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && !uploading) void start(dropped);
  }

  const shownError = failure ?? error ?? null;
  const attached = value && file;
  const isImage = file ? effectiveMime({ type: '', name: file.name }) === 'image/jpeg' : false;
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <div className="flex flex-col gap-3">
      {/* Visually hidden, but the real control: keyboard and screen readers use it. */}
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={REGISTRATION_FILE_ACCEPT}
        onChange={onPick}
        disabled={!!uploading}
        className="sr-only"
        aria-describedby={`${inputId}-hint`}
        aria-invalid={!!shownError}
      />

      {uploading ? (
        <div className="rounded-xl border border-border bg-muted/30 p-4" aria-live="polite">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{uploading.name}</p>
              <p className="text-xs text-muted-foreground">
                {t('fileUploading', { percent: Math.round(uploading.progress * 100) })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('fileCancel')}
            >
              <X className="size-5" />
            </button>
          </div>
          <div
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(uploading.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
              style={{ width: `${Math.round(uploading.progress * 100)}%` }}
            />
          </div>
        </div>
      ) : attached ? (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <div className="flex items-center gap-3">
            <Icon className="size-6 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <FileName name={file.name} />
              <p className="text-xs text-muted-foreground">
                {formatFileSize(file.size)} · {t('fileAttached')}
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <label
              htmlFor={inputId}
              className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
            >
              <Upload className="size-4" aria-hidden="true" />
              {t('fileReplace')}
            </label>
            <button
              type="button"
              onClick={() => { setFailure(null); onRemove(); }}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
            >
              <X className="size-4" aria-hidden="true" />
              {t('fileRemove')}
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            'focus-within:ring-2 focus-within:ring-ring',
            dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30',
            shownError && 'border-destructive/60',
          )}
        >
          <Paperclip className="size-7 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{t('fileChoose')}</span>
        </label>
      )}

      <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
        {t('fileHint', { max: MAX_REGISTRATION_FILE_MB })}
      </p>

      {shownError && (
        <p role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}
    </div>
  );
}

/**
 * A file name that reads correctly in a right-to-left page. "عرض.pdf" in one
 * run renders as "pdf.عرض" because the dot is bidi-neutral and joins the wrong
 * side; the extension is set as its own left-to-right piece so it stays ".pdf".
 */
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  return (
    <p className="flex min-w-0 text-sm font-medium">
      <span dir="auto" className="truncate">{base}</span>
      {ext && <span dir="ltr" className="shrink-0">{ext}</span>}
    </p>
  );
}
