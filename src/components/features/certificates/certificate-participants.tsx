'use client';

/**
 * Issuing a program's certificates: who attended, and their certificates.
 *
 * Every confirmed participant starts ticked — the host unticks whoever did
 * not come. Downloading or sending is what issues a certificate: its number
 * is fixed the first time, and stays the same on every reprint.
 *
 * Two versions, as in the editor: « Impression » to print, sign and stamp by
 * hand; « E-mail » with the signatures and stamp built in, for a training held
 * online. Sending by email always uses the e-mail version.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Download, Loader2, Mail, Palette, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { Locale } from '@/i18n/config';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CertificateMode, Civility } from '@/server/certificates/types';

interface Participant {
  registrationId: string;
  fullName: string;
  email: string;
  civility: Civility;
  absent: boolean;
  balanceDue: number;
  certificate: { number: string; issuedAt: string; emailedAt: string | null; revoked: boolean } | null;
}

interface Props {
  programId: string;
  apiBase: '/api/incubator/programs' | '/api/consultant/programs';
  /** Takes the host to the design tab, when nothing has been saved yet. */
  onEditDesign: () => void;
  /** Reload when the tab comes back into view — the design may have been saved meanwhile. */
  active: boolean;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

function filenameFrom(res: Response, fallback: string): string {
  const header = res.headers.get('content-disposition') ?? '';
  return /filename="([^"]+)"/.exec(header)?.[1] ?? fallback;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

type SendProgress = { sent: number; failed: Array<{ registrationId: string; fullName: string }>; running: boolean };

export function CertificateParticipants({ programId, apiBase, onEditDesign, active }: Props) {
  const t = useTranslations('certificates');
  const locale = useLocale() as Locale;
  const base = `${apiBase}/${programId}/certificates`;

  const [participants, setParticipants] = useState<Participant[] | null>(null);
  const [saved, setSaved] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<CertificateMode>('PRINT');

  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [progress, setProgress] = useState<SendProgress | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/participants`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
      const data = await res.json() as { participants: Participant[]; saved: boolean };
      setParticipants(data.participants);
      setSaved(data.saved);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }, [base, t]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  const present = useMemo(() => (participants ?? []).filter((p) => !p.absent), [participants]);
  const issuedCount = present.filter((p) => p.certificate && !p.certificate.revoked).length;
  const unsent = present.filter((p) => !p.certificate?.emailedAt);
  const owing = present.filter((p) => p.balanceDue > 0);

  /* ── One participant ── */
  async function patch(p: Participant, change: { absent?: boolean; civility?: Civility }) {
    // Optimistic: a tick should feel like a tick.
    setParticipants((list) => list?.map((x) => (x.registrationId === p.registrationId ? { ...x, ...change } : x)) ?? null);
    setActionError(null);
    try {
      const res = await fetch(`${base}/participants`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId: p.registrationId, ...change }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('saveFailed')));
      const { participant } = await res.json() as { participant: Participant };
      setParticipants((list) => list?.map((x) => (x.registrationId === participant.registrationId ? participant : x)) ?? null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('saveFailed'));
      void load();
    }
  }

  /* ── Download ── */
  async function download(registrationIds?: string[]) {
    const key = registrationIds?.[0] ?? 'all';
    setBusy(`download:${key}`);
    setActionError(null);
    try {
      const res = await fetch(`${base}/download`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...(registrationIds ? { registrationIds } : {}) }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('downloadFailed')));
      saveBlob(await res.blob(), filenameFrom(res, 'attestations.pdf'));
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('downloadFailed'));
    } finally {
      setBusy(null);
    }
  }

  /* ── Send ── */
  async function sendOne(p: Participant) {
    setBusy(`send:${p.registrationId}`);
    setActionError(null);
    try {
      const res = await fetch(`${base}/send`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationIds: [p.registrationId] }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('sendFailed')));
      const data = await res.json() as { sent: number };
      if (data.sent === 0) throw new Error(t('sendFailedFor', { name: p.fullName }));
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('sendFailed'));
    } finally {
      setBusy(null);
    }
  }

  /** Everyone not yet sent one, a batch per request until none remain. */
  async function sendAll() {
    setConfirmSend(false);
    setActionError(null);
    const failed: SendProgress['failed'] = [];
    let sent = 0;
    setProgress({ sent, failed, running: true });
    try {
      for (let round = 0; round < 50; round++) {
        const res = await fetch(`${base}/send`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(failed.length ? { skip: failed.map((f) => f.registrationId) } : {}),
        });
        if (!res.ok) throw new Error(await errorMessage(res, t('sendFailed')));
        const data = await res.json() as { sent: number; failed: SendProgress['failed']; remaining: number };
        sent += data.sent;
        failed.push(...data.failed);
        setProgress({ sent, failed: [...failed], running: true });
        if (data.remaining === 0 || (data.sent === 0 && data.failed.length === 0)) break;
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('sendFailed'));
    } finally {
      setProgress({ sent, failed: [...failed], running: false });
      void load();
    }
  }

  /* ── Render ── */
  if (loadError) {
    return <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</p>;
  }
  if (!participants) {
    return <div className="flex justify-center py-16 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  }

  if (!saved) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
        <Palette className="size-8 text-muted-foreground" />
        <p className="font-semibold">{t('notSavedTitle')}</p>
        <p className="max-w-md text-sm text-muted-foreground">{t('notSavedBody')}</p>
        <Button onClick={onEditDesign} className="mt-1">{t('chooseDesign')}</Button>
      </div>
    );
  }

  if (participants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        {t('noParticipants')}
      </div>
    );
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR');

  return (
    <div className="space-y-4">
      {/* Summary + version */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t('summary', { total: participants.length, present: present.length, issued: issuedCount })}
        </p>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label={t('previewMode')}>
          {(['PRINT', 'DIGITAL'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'min-h-8 rounded-md px-3 text-sm font-medium transition-colors',
                mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {m === 'PRINT' ? t('modePrint') : t('modeDigital')}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-2"
          onClick={() => void download()}
          loading={busy === 'download:all'}
          disabled={present.length === 0 || Boolean(busy) || progress?.running}
        >
          <Download className="size-4" />
          {t('downloadAll', { count: present.length })}
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => setConfirmSend(true)}
          disabled={unsent.length === 0 || Boolean(busy) || progress?.running}
        >
          <Mail className="size-4" />
          {unsent.length > 0 ? t('sendAll', { count: unsent.length }) : t('allSent')}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {mode === 'PRINT' ? t('modePrintHint') : t('modeDigitalHint')} {t('issueHint')}
      </p>

      {owing.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {t('owingNotice', { count: owing.length })}
        </p>
      )}

      {progress && (
        <div className={cn(
          'rounded-md border px-3 py-2 text-sm',
          progress.failed.length ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200'
            : 'border-primary/30 bg-primary/5 text-foreground',
        )}>
          <p className="flex items-center gap-2 font-medium">
            {progress.running ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4 text-primary" />}
            {progress.running ? t('sending', { sent: progress.sent }) : t('sentDone', { sent: progress.sent })}
          </p>
          {progress.failed.length > 0 && (
            <p className="mt-1 text-xs">{t('sendFailedList', { list: progress.failed.map((f) => f.fullName).join(', ') })}</p>
          )}
        </div>
      )}

      {actionError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{actionError}</p>
      )}

      {/* Participants */}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {participants.map((p) => {
          const cert = p.certificate;
          return (
            <li key={p.registrationId} className={cn('flex flex-col gap-3 p-3 sm:flex-row sm:items-center', p.absent && 'bg-muted/40')}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-primary"
                  checked={!p.absent}
                  onChange={(e) => void patch(p, { absent: !e.target.checked })}
                  aria-label={t('presentFor', { name: p.fullName })}
                />
                <span className="min-w-0">
                  <span className={cn('block truncate font-medium', p.absent && 'text-muted-foreground line-through')}>
                    {p.fullName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground" dir="ltr">{p.email}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {p.absent && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{t('absent')}</span>
                    )}
                    {p.balanceDue > 0 && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        {t('balanceDue', { amount: formatCurrency(p.balanceDue, locale) })}
                      </span>
                    )}
                    {cert && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.5 font-mono text-[11px] font-medium',
                          cert.revoked ? 'bg-destructive/10 text-destructive line-through' : 'bg-primary/10 text-primary',
                        )}
                        dir="ltr"
                      >
                        {cert.number}
                      </span>
                    )}
                    {cert?.revoked && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">{t('revoked')}</span>
                    )}
                    {cert?.emailedAt && !cert.revoked && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {t('emailedOn', { date: fmtDate(cert.emailedAt) })}
                      </span>
                    )}
                  </span>
                </span>
              </label>

              <div className="flex items-center gap-2 ps-7 sm:ps-0">
                <select
                  value={p.civility ?? ''}
                  onChange={(e) => void patch(p, { civility: (e.target.value || null) as Civility })}
                  disabled={p.absent}
                  aria-label={t('civilityFor', { name: p.fullName })}
                  className="h-9 rounded-md border border-input bg-background px-2 text-base sm:text-sm"
                >
                  <option value="">{t('civilityNone')}</option>
                  <option value="M.">M.</option>
                  <option value="Mme">Mme</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void download([p.registrationId])}
                  loading={busy === `download:${p.registrationId}`}
                  disabled={p.absent || (Boolean(busy) && busy !== `download:${p.registrationId}`) || progress?.running}
                  aria-label={t('downloadFor', { name: p.fullName })}
                >
                  <Download className="size-3.5" />
                  <span className="hidden md:inline">PDF</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => void sendOne(p)}
                  loading={busy === `send:${p.registrationId}`}
                  disabled={p.absent || (Boolean(busy) && busy !== `send:${p.registrationId}`) || progress?.running}
                  aria-label={t('sendFor', { name: p.fullName })}
                  title={cert?.emailedAt ? t('resend') : t('send')}
                >
                  <Send className="size-3.5" />
                  <span className="hidden md:inline">{cert?.emailedAt ? t('resend') : t('send')}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={confirmSend} onOpenChange={setConfirmSend}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('sendConfirmTitle', { count: unsent.length })}</DialogTitle>
            <DialogDescription>{t('sendConfirmBody')}</DialogDescription>
          </DialogHeader>
          {unsent.some((p) => p.balanceDue > 0) && (
            <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {t('sendConfirmOwing', { count: unsent.filter((p) => p.balanceDue > 0).length })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSend(false)}>{t('cancel')}</Button>
            <Button className="gap-2" onClick={() => void sendAll()}>
              <Send className="size-4" /> {t('sendConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
