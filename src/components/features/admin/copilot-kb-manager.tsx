'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { KbDocument } from '@/server/copilot/kb';
import type { CopilotKbPointer } from '@/server/db/store';

const KNOWN_ERRORS = ['FILE_TOO_LARGE', 'UNSUPPORTED_FILE', 'NO_TEXT', 'UNREADABLE_PDF', 'CONFLICT', 'STORAGE_UNAVAILABLE'] as const;

/** The copilot's documents: what it answers from, and adding a new text without a deploy. */
export function CopilotKbManager() {
  const t = useTranslations('admin.copilotKb');
  const locale = useLocale() as Locale;
  const [docs, setDocs] = useState<KbDocument[] | null>(null);
  const [pointer, setPointer] = useState<CopilotKbPointer | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch('/api/admin/copilot-kb');
    if (!res.ok) return;
    const body = (await res.json()) as { pointer: CopilotKbPointer | null; documents: KbDocument[] };
    setDocs(body.documents);
    setPointer(body.pointer);
  }
  useEffect(() => { void load(); }, []);

  async function errorText(res: Response) {
    const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? '';
    return t(`errors.${(KNOWN_ERRORS as readonly string[]).includes(code) ? code : 'GENERIC'}`);
  }

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/admin/copilot-kb', { method: 'POST', body });
    if (fileRef.current) fileRef.current.value = '';
    if (res.ok) {
      const { document } = (await res.json()) as { document: KbDocument };
      setMsg({ ok: true, text: t('uploaded', { title: document.title, chunks: document.chunks }) });
      await load();
    } else setMsg({ ok: false, text: await errorText(res) });
    setBusy(false);
  }

  async function remove(d: KbDocument) {
    if (!window.confirm(t('confirmDelete', { title: d.title }))) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/copilot-kb/${encodeURIComponent(d.id)}`, { method: 'DELETE' });
    if (res.ok) await load();
    else setMsg({ ok: false, text: await errorText(res) });
    setBusy(false);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">{t('howTo')}</p>
        <input ref={fileRef} type="file" accept="application/pdf" className="sr-only" aria-label={t('upload')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <Button type="button" loading={busy} onClick={() => fileRef.current?.click()}><FileUp className="size-4" />{t('upload')}</Button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-destructive'}>{msg.text}</p>}
        <p className="text-xs text-muted-foreground">
          {pointer
            ? t('live', { date: formatDate(pointer.builtAt, locale, { dateStyle: 'medium', timeStyle: 'short' }), documents: pointer.documents, chunks: pointer.chunks })
            : t('notPublished')}
        </p>
      </div>

      {docs === null ? (
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      ) : docs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{d.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge>{t(`category.${d.category}`)}</Badge>
                  {d.year && <span>{d.year}</span>}
                  <span>{t('pagesChunks', { pages: d.pages, chunks: d.chunks })}</span>
                  <span>{d.origin === 'ADMIN' ? t('originAdmin') : t('originSync')}</span>
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" className="self-start text-destructive sm:self-auto" disabled={busy} onClick={() => void remove(d)}>
                <Trash2 className="size-4" />{t('delete')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
