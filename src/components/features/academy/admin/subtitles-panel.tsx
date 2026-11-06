'use client';

/**
 * A lesson's subtitles in the course builder: upload the .vtt from the
 * whisper pipeline for one language, draft the two others with AI, read any
 * language, remove one. A drafted language is replaced by uploading a
 * corrected file.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Captions, Eye, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { parseVtt, VTT_MAX_BYTES } from '@/lib/vtt';
import { cn } from '@/lib/utils';

type Lang = 'fr' | 'en' | 'ar';
export interface TrackState { lang: Lang; drafted: boolean }
const LANGS: Lang[] = ['fr', 'en', 'ar'];

export function SubtitlesPanel({ base, initial }: { base: string; initial: TrackState[] }) {
  const t = useTranslations('academyAdmin.builder.subtitles');
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<{ lang: Lang; vtt: string } | null>(null);

  const fail = (err: unknown) => {
    const code = err instanceof ApiClientError ? err.code : '';
    setError(['INVALID_VTT', 'TOO_LARGE', 'NO_VIDEO', 'NO_SOURCE', 'UNAVAILABLE', 'RATE_LIMITED', 'LOCKED', 'UPSTREAM'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
  };

  async function upload(lang: Lang, file: File) {
    setError(null);
    if (file.size > VTT_MAX_BYTES) return setError(t('errors.TOO_LARGE'));
    const vtt = await file.text();
    if (!parseVtt(vtt)) return setError(t('errors.INVALID_VTT'));
    setBusy(`up-${lang}`);
    try {
      await apiClient.post(base, { lang, vtt });
      setTracks((ts) => [...ts.filter((x) => x.lang !== lang), { lang, drafted: false }]);
    } catch (err) { fail(err); } finally { setBusy(null); }
  }

  async function translate() {
    setBusy('ai');
    setError(null);
    try {
      const res = await apiClient.post<{ drafted: Lang[] }>(`${base}/translate`);
      setTracks((ts) => [...ts.filter((x) => !res.drafted.includes(x.lang)), ...res.drafted.map((lang) => ({ lang, drafted: true }))]);
    } catch (err) { fail(err); } finally { setBusy(null); }
  }

  async function show(lang: Lang) {
    setBusy(`view-${lang}`);
    setError(null);
    try { setView(await apiClient.get<{ lang: Lang; vtt: string }>(`${base}?lang=${lang}`)); } catch (err) { fail(err); } finally { setBusy(null); }
  }

  async function remove(lang: Lang) {
    setBusy(`del-${lang}`);
    setError(null);
    try {
      await apiClient.delete(`${base}?lang=${lang}`);
      setTracks((ts) => ts.filter((x) => x.lang !== lang));
      if (view?.lang === lang) setView(null);
    } catch (err) { fail(err); } finally { setBusy(null); }
  }

  const hasSource = tracks.some((x) => !x.drafted);
  return (
    <div className="ps-8">
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <Captions className="size-3.5" />{t('toggle', { count: tracks.length })}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3 text-xs">
          <ul className="space-y-1.5">
            {LANGS.map((lang) => {
              const tr = tracks.find((x) => x.lang === lang);
              return (
                <li key={lang} className="flex flex-wrap items-center gap-2">
                  <span className="w-8 font-bold uppercase">{lang}</span>
                  <span className={cn('me-auto shrink-0', tr ? (tr.drafted ? 'text-amber-700 dark:text-amber-400' : 'text-primary') : 'text-muted-foreground')}>
                    {tr ? (tr.drafted ? t('drafted') : t('uploaded')) : t('none')}
                  </span>
                  <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-semibold hover:bg-accent">
                    {busy === `up-${lang}` ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}{tr ? t('replace') : t('upload')}
                    <input type="file" accept=".vtt,text/vtt" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(lang, f); }} />
                  </label>
                  {tr && <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t('view')} onClick={() => show(lang)}><Eye className="size-3.5" /></Button>}
                  {tr && <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={t('remove')} onClick={() => remove(lang)}><Trash2 className="size-3.5" /></Button>}
                </li>
              );
            })}
          </ul>
          <Button type="button" size="sm" variant="outline" disabled={!hasSource || busy !== null} onClick={translate}>
            {busy === 'ai' ? <Loader2 className="me-1 size-3.5 animate-spin" /> : <Sparkles className="me-1 size-3.5" />}{t('translate')}
          </Button>
          <p className="text-muted-foreground">{t('hint')}</p>
          {error && <p role="alert" className="text-destructive">{error}</p>}
          {view && (
            <div className="space-y-1">
              <p className="font-semibold">{t('viewing', { lang: view.lang.toUpperCase() })}</p>
              <Textarea readOnly dir={view.lang === 'ar' ? 'rtl' : 'ltr'} rows={8} value={view.vtt} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="ghost" onClick={() => setView(null)}>{t('close')}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
