'use client';

/**
 * « Envoi » — who gets the feedback form. One button for everyone not sent it
 * yet (sent in batches until done), ticked people for a targeted send, and a
 * per-row Envoyer / Renvoyer. The shared link, when on, is copied from here.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Copy, Link2, Loader2, RefreshCw, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { errorMessage } from './shared';

interface Participant {
  registrationId: string;
  fullName: string;
  email: string;
  sentAt: string | null;
  responded: boolean;
}

/** The server sends this many per request; a targeted send is capped to it. */
const BATCH = 20;

interface Props {
  base: string;
  active: boolean;
  saved: boolean;
  isOpen: boolean;
  sharedUrl: string | null;
  onRotated: () => void;
}

export function FeedbackSend({ base, active, saved, isOpen, sharedUrl, onRotated }: Props) {
  const t = useTranslations('feedback');
  const locale = useLocale();
  const [people, setPeople] = useState<Participant[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/participants`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
      setPeople(((await res.json()) as { items: Participant[] }).items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }, [base, t]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  const unsent = useMemo(() => (people ?? []).filter((p) => !p.sentAt), [people]);
  const sentCount = (people ?? []).length - unsent.length;
  const answered = (people ?? []).filter((p) => p.responded).length;
  const blocked = !saved ? t('sendNeedsSave') : !isOpen ? t('sendNeedsOpen') : null;

  async function call(body: Record<string, unknown>) {
    const res = await fetch(`${base}/send`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorMessage(res, t('sendFailed')));
    return await res.json() as { sent: number; failed: Array<{ registrationId: string; fullName: string }>; remaining: number };
  }

  /** Everyone not sent yet, batch after batch, until none remain. */
  async function sendAll() {
    if (!window.confirm(t('confirmSendAll', { count: unsent.length }))) return;
    setBusy('all'); setError(null); setReport(null);
    let sent = 0;
    const failed: Array<{ registrationId: string; fullName: string }> = [];
    try {
      for (let guard = 0; guard < 100; guard += 1) {
        const r = await call({ skip: failed.map((f) => f.registrationId) });
        sent += r.sent;
        failed.push(...r.failed);
        if (r.remaining === 0 || (r.sent === 0 && r.failed.length === 0)) break;
      }
      setReport(failed.length
        ? t('reportFailed', { sent, names: failed.map((f) => f.fullName).join(', ') })
        : t('reportSent', { count: sent }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sendFailed'));
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function sendTo(ids: string[], key: string) {
    if (ids.length === 0) return;
    setBusy(key); setError(null); setReport(null);
    try {
      const r = await call({ registrationIds: ids });
      setReport(r.failed.length
        ? t('reportFailed', { sent: r.sent, names: r.failed.map((f) => f.fullName).join(', ') })
        : t('reportSent', { count: r.sent }));
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sendFailed'));
    } finally {
      setBusy(null);
      void load();
    }
  }

  async function copy() {
    if (!sharedUrl) return;
    try { await navigator.clipboard.writeText(sharedUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt(t('copyManual'), sharedUrl); }
  }

  async function rotate() {
    if (!window.confirm(t('rotateConfirm'))) return;
    setBusy('rotate'); setError(null);
    try {
      const res = await fetch(`${base}/rotate-link`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('saveFailed')));
      onRotated();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else if (next.size < BATCH) next.add(id);
    return next;
  });

  if (people === null && !error) {
    return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {blocked && <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">{blocked}</p>}

      {sharedUrl && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Link2 className="size-4 text-primary" /> {t('sharedTitle')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code dir="ltr" className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 text-xs">{sharedUrl}</code>
            <Button size="sm" variant="outline" onClick={() => void copy()}><Copy className="size-3.5" /> {copied ? t('copied') : t('copy')}</Button>
            <Button size="sm" variant="ghost" loading={busy === 'rotate'} onClick={() => void rotate()}><RefreshCw className="size-3.5" /> {t('rotate')}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('sharedNote')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">{t('participantsCount', { count: (people ?? []).length })}</p>
          <p className="text-sm text-muted-foreground">{t('sentAnswered', { sent: sentCount, answered })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {selected.size > 0 && (
            <Button variant="outline" disabled={Boolean(blocked) || busy !== null} loading={busy === 'selected'}
              onClick={() => void sendTo([...selected], 'selected')}>
              <Send className="size-4" /> {t('sendSelected', { count: selected.size })}
            </Button>
          )}
          <Button disabled={Boolean(blocked) || unsent.length === 0 || busy !== null} loading={busy === 'all'}
            onClick={() => void sendAll()}>
            <Send className="size-4" /> {t('sendAll', { count: unsent.length })}
          </Button>
        </div>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {report && <p role="status" className="rounded-md bg-primary/10 px-3 py-2 text-sm">{report}</p>}

      {(people ?? []).length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t('noParticipants')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(people ?? []).map((p) => (
            <li key={p.registrationId} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
              <input
                type="checkbox" className="size-4 accent-primary"
                checked={selected.has(p.registrationId)}
                disabled={!selected.has(p.registrationId) && selected.size >= BATCH}
                aria-label={t('selectPerson', { name: p.fullName })}
                onChange={() => toggle(p.registrationId)}
              />
              <span className="min-w-0">
                <span dir="auto" className="block truncate text-sm font-medium">{p.fullName}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
              </span>
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className={cn(
                  'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
                  p.responded ? 'bg-primary/15 text-primary'
                    : p.sentAt ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {p.responded ? t('statusAnswered')
                    : p.sentAt ? t('statusSent', { date: new Date(p.sentAt).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale) })
                    : t('statusNotSent')}
                </span>
                <Button size="sm" variant="ghost" disabled={Boolean(blocked) || busy !== null}
                  loading={busy === p.registrationId}
                  onClick={() => void sendTo([p.registrationId], p.registrationId)}>
                  {p.sentAt ? t('resend') : t('send')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {selected.size >= BATCH && <p className="text-xs text-muted-foreground">{t('selectLimit', { count: BATCH })}</p>}
    </div>
  );
}
