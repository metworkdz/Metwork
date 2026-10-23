'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';
import type { Locale } from '@/i18n/config';

const STATUSES = ['TODO', 'IN_PROGRESS', 'DELIVERED', 'PAID'] as const;
type Status = (typeof STATUSES)[number];

export interface BoardProject {
  id: string;
  title: string;
  clientName: string | null;
  status: Status;
  dueDate: string | null;
  amount: number | null;
}

/**
 * The freelancer's project board. Four columns from md up; on a phone the
 * columns become tabs so a card is never a horizontal scroll away.
 */
export function ProjectsBoard({ initial }: { initial: BoardProject[] }) {
  const t = useTranslations('freelancer.projects');
  const locale = useLocale() as Locale;
  const [projects, setProjects] = useState(initial);
  const [mobileTab, setMobileTab] = useState<Status>('IN_PROGRESS');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(p: BoardProject, status: Status) {
    const prev = projects;
    setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, status } : x)));
    const res = await fetch(`/api/freelancer/projects/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { setProjects(prev); setError(t('saveError')); }
  }

  async function remove(p: BoardProject) {
    const prev = projects;
    setProjects((ps) => ps.filter((x) => x.id !== p.id));
    const res = await fetch(`/api/freelancer/projects/${p.id}`, { method: 'DELETE' });
    if (!res.ok) { setProjects(prev); setError(t('saveError')); }
  }

  const column = (s: Status) => projects.filter((p) => p.status === s);
  const today = new Date().toISOString().slice(0, 10);

  const card = (p: BoardProject) => (
    <li key={p.id} className="space-y-2 rounded-lg border bg-background p-3 shadow-sm">
      <p className="font-medium leading-snug">{p.title}</p>
      {p.clientName && <p className="text-xs text-muted-foreground">{p.clientName}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.dueDate && (
          <span className={cn('inline-flex items-center gap-1', p.status !== 'PAID' && p.dueDate < today ? 'text-destructive' : 'text-muted-foreground')}>
            <CalendarDays className="size-3.5" />
            {new Date(`${p.dueDate}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
          </span>
        )}
        {p.amount != null && <span className="font-medium tabular-nums">{formatCurrency(p.amount, locale)}</span>}
      </div>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor={`move-${p.id}`}>{t('moveTo')}</label>
        <select
          id={`move-${p.id}`}
          value={p.status}
          onChange={(e) => void move(p, e.target.value as Status)}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-base sm:text-sm"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select>
        <Button type="button" variant="ghost" size="icon" className="size-9 text-muted-foreground" aria-label={t('delete')} onClick={() => void remove(p)}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('count', { count: projects.filter((p) => p.status !== 'PAID').length })}</p>
        <Button type="button" onClick={() => setOpen(true)}><Plus className="size-4" />{t('new')}</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {/* Phone: one column at a time */}
      <div className="md:hidden">
        <div className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/40 p-1" role="tablist">
          {STATUSES.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={mobileTab === s} onClick={() => setMobileTab(s)}
              className={cn('min-h-[40px] rounded-md px-1 text-xs font-medium', mobileTab === s ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
              {t(`status.${s}`)} <span className="tabular-nums">{column(s).length}</span>
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-3">{column(mobileTab).map(card)}</ul>
        {column(mobileTab).length === 0 && <p className="mt-6 text-center text-sm text-muted-foreground">{t('empty')}</p>}
      </div>

      {/* md+: the four columns */}
      <div className="hidden gap-3 md:grid md:grid-cols-4">
        {STATUSES.map((s) => (
          <section key={s} className="rounded-lg bg-muted/40 p-2">
            <h2 className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-muted-foreground">
              {t(`status.${s}`)} <span className="tabular-nums">{column(s).length}</span>
            </h2>
            <ul className="space-y-2">{column(s).map(card)}</ul>
          </section>
        ))}
      </div>

      <NewProjectDialog open={open} onOpenChange={setOpen} onCreated={(p) => { setProjects((ps) => [p, ...ps]); setMobileTab(p.status); }} />
    </div>
  );
}

function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (p: BoardProject) => void }) {
  const t = useTranslations('freelancer.projects');
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [due, setDue] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  async function create() {
    setBusy(true);
    setErr(false);
    const res = await fetch('/api/freelancer/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title.trim(), clientName: client.trim() || null, clientId: null, status: 'TODO',
        dueDate: due || null, amount: amount ? Number(amount) : null, notes: null,
      }),
    });
    setBusy(false);
    if (!res.ok) { setErr(true); return; }
    onCreated((await res.json()) as BoardProject);
    setTitle(''); setClient(''); setDue(''); setAmount('');
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={SHEET_CONTENT_CLASS}>
        <DialogHeader><DialogTitle>{t('new')}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <Field id="np-title" label={t('title')}><Input id="np-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className="text-base sm:text-sm" /></Field>
          <Field id="np-client" label={t('client')}><Input id="np-client" value={client} maxLength={120} onChange={(e) => setClient(e.target.value)} className="text-base sm:text-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="np-due" label={t('due')}><Input id="np-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="text-base sm:text-sm" /></Field>
            <Field id="np-amount" label={t('amount')}><Input id="np-amount" inputMode="numeric" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').slice(0, 10))} className="text-base tabular-nums sm:text-sm" /></Field>
          </div>
          {err && <p role="alert" className="text-sm text-destructive">{t('saveError')}</p>}
          <Button type="button" className="w-full" loading={busy} disabled={!title.trim()} onClick={() => void create()}>{t('create')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}
