'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, ChevronDown, FileUp, Paperclip, RotateCcw, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link } from '@/i18n/routing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Locale } from '@/i18n/config';
import type { TaxCenterView, TaxTaskView } from '@/server/taxes/service';

/** Steps per guide, in the `taxCenter.guides.<id>` namespace (s1…sN). */
const GUIDE_STEPS: Record<TaxTaskView['obligation'], number> = {
  G12: 4, G12_BIS: 4, IFU_INSTALMENT_SEPT: 3, IFU_INSTALMENT_DEC: 3,
  CASNOS_DECLARATION: 3, CASNOS_PAYMENT: 3, G50: 4, G4: 3, G11: 3, G13: 3,
};

interface Props {
  view: TaxCenterView;
  /** Where the legal status is set: the freelancer profile or the venture page. */
  legalHref: string;
  membershipHref: string;
  /** Prefill reads factures, so it is offered only where Metwork issues them (freelancers). */
  offerPrefill: boolean;
}

/** The tax & social calendar: what is due, when, how to do it, and proof it was done. */
export function TaxCenter({ view, legalHref, membershipHref, offerPrefill }: Props) {
  const t = useTranslations('taxCenter');
  const [tasks, setTasks] = useState(view.tasks);
  const [regime, setRegime] = useState(view.regime);
  const [needsRegime, setNeedsRegime] = useState(view.needsRegime);

  async function chooseRegime(r: 'IFU' | 'REEL') {
    const res = await fetch('/api/tax/regime', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regime: r }),
    });
    if (!res.ok) return;
    setRegime(r);
    setNeedsRegime(false);
    // The task list depends on the regime: reload it from the server.
    const next = await fetch('/api/tax/tasks');
    if (next.ok) setTasks(((await next.json()) as TaxCenterView).tasks);
  }

  const open = tasks.filter((x) => x.state !== 'DONE');
  const done = tasks.filter((x) => x.state === 'DONE');
  const update = (key: string, patch: Partial<TaxTaskView>) =>
    setTasks((ts) => ts.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-5">
      <div role="note" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <Scale className="mt-0.5 size-4 shrink-0" />
        <p>{t('disclaimer')}</p>
      </div>

      {!view.profile ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">{t('noProfileTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('noProfileBody')}</p>
          <Button asChild className="mt-4"><Link href={legalHref}>{t('noProfileCta')}</Link></Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border p-3 text-sm sm:p-4">
            <span className="text-muted-foreground">{t('yourStatus')}</span>
            <span className="font-medium">{t(`status.${view.profile.status}`)}</span>
            {regime && <Badge>{t(`regime.${regime}`)}</Badge>}
            <Link href={legalHref} className="ms-auto text-sm font-medium text-primary hover:underline">{t('change')}</Link>
          </div>

          {needsRegime && (
            <div className="space-y-3 rounded-lg border border-primary-200 bg-primary-50/50 p-4 dark:bg-primary/10">
              <p className="text-sm font-medium">{t('chooseRegime')}</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => void chooseRegime('IFU')}>{t('regime.IFU')}</Button>
                <Button type="button" variant="outline" onClick={() => void chooseRegime('REEL')}>{t('regime.REEL')}</Button>
              </div>
            </div>
          )}

          {offerPrefill && !view.prefillEnabled && tasks.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t('prefillUpsell')}{' '}
              <Link href={membershipHref} className="font-medium text-primary hover:underline">{t('upgrade')}</Link>
            </p>
          )}

          {tasks.length === 0 && !needsRegime && (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('noTasks')}</p>
          )}

          {open.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t('toDo')}</h2>
              {open.map((task) => <TaskCard key={task.key} task={task} onChange={(p) => update(task.key, p)} />)}
            </section>
          )}
          {done.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">{t('doneTitle')}</h2>
              {done.map((task) => <TaskCard key={task.key} task={task} onChange={(p) => update(task.key, p)} />)}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TaskCard({ task, onChange }: { task: TaxTaskView; onChange: (p: Partial<TaxTaskView>) => void }) {
  const t = useTranslations('taxCenter');
  const locale = useLocale() as Locale;
  const [openGuide, setOpenGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const path = `/api/tax/tasks/${encodeURIComponent(task.key)}`;
  const due = formatDate(`${task.dueDate}T12:00:00Z`, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const money = (n: number) => formatCurrency(n, locale);

  async function toggleDone() {
    setBusy(true);
    setErr(null);
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: task.state !== 'DONE' }),
    });
    setBusy(false);
    if (!res.ok) { setErr(t('saveError')); return; }
    const { doneAt } = (await res.json()) as { doneAt: string | null };
    onChange({ doneAt, state: doneAt ? 'DONE' : task.daysLeft < 0 ? 'LATE' : task.daysLeft <= 15 ? 'DUE_SOON' : 'UPCOMING' });
  }

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${path}/receipt`, { method: 'POST', body });
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) {
      const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code;
      setErr(code === 'FILE_TOO_LARGE' ? t('fileTooLarge') : code === 'UNSUPPORTED_FILE' ? t('fileUnsupported') : t('uploadError'));
      return;
    }
    const { doneAt } = (await res.json()) as { doneAt: string };
    onChange({ doneAt, state: 'DONE', hasReceipt: true });
  }

  const steps = GUIDE_STEPS[task.obligation];
  return (
    <article className={cn('rounded-lg border p-4', task.state === 'LATE' && 'border-destructive/60', task.state === 'DONE' && 'opacity-80')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug">{t(`obligation.${task.obligation}`)}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {task.form ? `${task.form} · ` : ''}{t('period', { period: task.period })}
          </p>
        </div>
        <StateBadge task={task} />
      </div>

      <p className="mt-3 text-sm">
        {t('dueOn', { date: due })}
        {task.state !== 'DONE' && task.daysLeft >= 0 && <span className="text-muted-foreground"> · {t('daysLeft', { count: task.daysLeft })}</span>}
      </p>

      {task.prefill && (
        <dl className="mt-3 grid grid-cols-1 gap-2 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-3">
          {task.prefill.turnover !== undefined && (
            <div><dt className="text-xs text-muted-foreground">{task.obligation === 'G12' ? t('prefillLastYear') : t('prefillTurnover')}</dt><dd className="font-semibold tabular-nums">{money(task.prefill.turnover)}</dd></div>
          )}
          {task.prefill.vat !== undefined && (
            <div><dt className="text-xs text-muted-foreground">{t('prefillVat')}</dt><dd className="font-semibold tabular-nums">{money(task.prefill.vat)}</dd></div>
          )}
          {task.prefill.estimatedIfu !== undefined && (
            <div><dt className="text-xs text-muted-foreground">{t('prefillIfu')}</dt><dd className="font-semibold tabular-nums">{money(task.prefill.estimatedIfu)}</dd></div>
          )}
          <p className="text-xs text-muted-foreground sm:col-span-3">{t('prefillNote')}</p>
        </dl>
      )}

      <button
        type="button"
        className="mt-3 flex min-h-[40px] w-full items-center justify-between gap-2 text-start text-sm font-medium text-primary"
        aria-expanded={openGuide}
        onClick={() => setOpenGuide((o) => !o)}
      >
        {t('howTo')}
        <ChevronDown className={cn('size-4 transition-transform', openGuide && 'rotate-180')} />
      </button>
      {openGuide && (
        <div className="space-y-2 text-sm">
          <ol className="list-decimal space-y-1.5 ps-5">
            {Array.from({ length: steps }, (_, i) => <li key={i}>{t(`guides.${task.obligation}.s${i + 1}`)}</li>)}
          </ol>
          <p className="text-xs text-muted-foreground">
            {t('source')}: {task.source.document ? `${task.source.document.split('/').pop()} — ${task.source.reference}` : t('sourceMetwork')}
          </p>
        </div>
      )}

      {err && <p role="alert" className="mt-2 text-sm text-destructive">{err}</p>}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" variant={task.state === 'DONE' ? 'ghost' : 'default'} size="sm" loading={busy} onClick={() => void toggleDone()}>
          {task.state === 'DONE' ? <><RotateCcw className="size-4" />{t('reopen')}</> : <><CheckCircle2 className="size-4" />{t('markDone')}</>}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label={t('uploadReceipt')}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" />{task.hasReceipt ? t('replaceReceipt') : t('uploadReceipt')}
        </Button>
        {task.hasReceipt && (
          <Button asChild variant="ghost" size="sm">
            <a href={`${path}/receipt`} target="_blank" rel="noopener noreferrer"><Paperclip className="size-4" />{t('viewReceipt')}</a>
          </Button>
        )}
      </div>
    </article>
  );
}

function StateBadge({ task }: { task: TaxTaskView }) {
  const t = useTranslations('taxCenter');
  if (task.state === 'DONE') return <Badge variant="success">{t('state.DONE')}</Badge>;
  if (task.state === 'LATE') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
        <AlertTriangle className="size-3.5" />{t('state.LATE')}
      </span>
    );
  }
  if (task.state === 'DUE_SOON') return <Badge variant="warning">{t('state.DUE_SOON')}</Badge>;
  return <Badge>{t('state.UPCOMING')}</Badge>;
}
