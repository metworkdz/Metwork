'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';

interface Person { id: string; name: string; email: string | null; status: string | null }
interface Report {
  id: string;
  reason: string;
  note: string | null;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
  reporter: Person;
  reported: Person;
  snapshot: { senderId: string; body: string; createdAt: string }[];
}

/** Reported conversations: what was reported (frozen at report time), and who. */
export function MessageReportsManager() {
  const t = useTranslations('admin.messageReports');
  const locale = useLocale() as Locale;
  const [reports, setReports] = useState<Report[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/admin/message-reports');
    if (res.ok) setReports(((await res.json()) as { reports: Report[] }).reports);
  }
  useEffect(() => { void load(); }, []);

  async function resolve(id: string) {
    const res = await fetch(`/api/admin/message-reports/${id}`, { method: 'PATCH' });
    if (res.ok) await load();
  }

  if (!reports) return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (!reports.length) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;

  return (
    <ul className="space-y-3">
      {reports.map((r) => (
        <li key={r.id} className="space-y-2 rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={r.status === 'OPEN' ? 'warning' : 'default'}>{t(`status.${r.status}`)}</Badge>
                <Badge variant="danger">{t(`reasons.${r.reason}`)}</Badge>
                <span className="text-xs text-muted-foreground">{formatDate(r.createdAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </p>
              <p>{t('reported')}: <b>{r.reported.name}</b> {r.reported.email && <span className="text-muted-foreground">({r.reported.email})</span>}</p>
              <p className="text-muted-foreground">{t('by')}: {r.reporter.name}</p>
              {r.note && <p className="whitespace-pre-wrap rounded bg-muted/50 p-2">{r.note}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{t('messages', { count: r.snapshot.length })}</Button>
              {r.status === 'OPEN' && <Button type="button" size="sm" onClick={() => void resolve(r.id)}>{t('resolve')}</Button>}
            </div>
          </div>
          {open === r.id && (
            <ol className="max-h-80 space-y-1.5 overflow-y-auto rounded-md bg-muted/40 p-3 text-sm">
              {r.snapshot.map((m, i) => (
                <li key={i}>
                  <span className={m.senderId === r.reported.id ? 'font-semibold text-destructive' : 'font-semibold'}>
                    {m.senderId === r.reported.id ? r.reported.name : r.reporter.name}
                  </span>
                  <span className="text-xs text-muted-foreground"> · {formatDate(m.createdAt, locale, { dateStyle: 'short', timeStyle: 'short' })}</span>
                  <p className="whitespace-pre-wrap break-words">{m.body || '—'}</p>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}
