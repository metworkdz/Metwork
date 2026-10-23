'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, ArrowUp, BellOff, Bell, Ban, FileText, Flag, Link2, MessageSquare, MoreVertical, Package, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MemberBadge } from '@/components/shared/member-badge';
import { Link, useRouter } from '@/i18n/routing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SHEET_CONTENT_CLASS } from '@/components/features/wallet/payout-account';
import { useNotificationCounts } from '@/hooks/use-notification-counts';
import type { Locale } from '@/i18n/config';
import type { AttachmentView, MessageView, ThreadSummary, ThreadView } from '@/server/messaging/service';

const THREAD_POLL_MS = 5_000;
const INBOX_POLL_MS = 20_000;
const REPORT_REASONS = ['SPAM', 'HARASSMENT', 'SCAM', 'INAPPROPRIATE', 'OTHER'] as const;

/** Poll while the tab is visible; immediately when it comes back. */
function useVisiblePoll(fn: () => void, ms: number, enabled = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    const tick = () => { if (document.visibilityState === 'visible') ref.current(); };
    const id = window.setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [ms, enabled]);
}

async function errorCode(res: Response): Promise<string> {
  return ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? 'GENERIC';
}

interface Props {
  basePath: string;
  initialThreadId: string | null;
  canAttach: boolean;
}

/** The inbox: threads on the left (or first, on a phone), the open thread on the right. */
export function Inbox({ basePath, initialThreadId, canAttach }: Props) {
  const t = useTranslations('inbox');
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialThreadId);
  const [unavailable, setUnavailable] = useState(false);
  const { refresh: refreshBadges } = useNotificationCounts();

  const loadInbox = useCallback(async () => {
    const res = await fetch('/api/messages', { cache: 'no-store' });
    if (res.status === 503) { setUnavailable(true); return; }
    if (res.ok) setThreads(((await res.json()) as { threads: ThreadSummary[] }).threads);
    // The nav badge counts unread threads: keep it in step with the list.
    void refreshBadges();
  }, [refreshBadges]);
  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useVisiblePoll(() => void loadInbox(), INBOX_POLL_MS);

  const open = (id: string | null) => {
    setOpenId(id);
    router.replace(id ? `${basePath}?c=${id}` : basePath, { scroll: false });
  };

  if (unavailable) return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('unavailable')}</p>;

  return (
    <div className="grid h-[calc(100dvh-17rem)] min-h-[380px] md:h-[calc(100dvh-13rem)] overflow-hidden rounded-lg border md:grid-cols-[320px_1fr]">
      <aside className={cn('min-h-0 overflow-y-auto border-e', openId && 'hidden md:block')} aria-label={t('threads')}>
        {threads === null ? (
          <p className="p-4 text-sm text-muted-foreground">{t('loading')}</p>
        ) : threads.length === 0 ? (
          <div className="space-y-2 p-6 text-center">
            <MessageSquare className="mx-auto size-8 text-muted-foreground" />
            <p className="text-sm font-medium">{t('emptyTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('emptyBody')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {threads.map((th) => (
              <li key={th.id}>
                <button
                  type="button"
                  onClick={() => open(th.id)}
                  className={cn('flex w-full items-start gap-3 p-3 text-start transition-colors hover:bg-muted/50', th.id === openId && 'bg-muted/70')}
                >
                  <Avatar name={th.other.name} url={th.other.avatarUrl} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn('truncate text-sm', th.unread ? 'font-semibold' : 'font-medium')}>{th.other.name}</span>
                      {th.other.badge && <MemberBadge badge={th.other.badge} />}
                      {th.muted && <BellOff className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('muted')} />}
                    </span>
                    {th.context.title && <span className="block truncate text-xs text-primary-700">{th.context.title}</span>}
                    <span className={cn('block truncate text-xs', th.unread ? 'text-foreground' : 'text-muted-foreground')}>
                      {th.lastFromMe && `${t('you')} `}<bdi>{th.preview}</bdi>
                    </span>
                  </span>
                  {th.unread && <span className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary" aria-label={t('unread')} />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className={cn('min-h-0', !openId && 'hidden md:flex md:items-center md:justify-center')}>
        {openId ? (
          <Thread key={openId} id={openId} canAttach={canAttach} ordersPath={basePath.replace(/messages$/, 'orders')} onBack={() => open(null)} onChanged={() => void loadInbox()} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('pick')}</p>
        )}
      </section>
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote avatar, sized here
    <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">{initials}</span>
  );
}

function Thread({ id, canAttach, ordersPath, onBack, onChanged }: { id: string; canAttach: boolean; ordersPath: string; onBack: () => void; onChanged: () => void }) {
  const t = useTranslations('inbox');
  const locale = useLocale() as Locale;
  const [view, setView] = useState<ThreadView | null>(null);
  const [missing, setMissing] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastAt = view?.messages[view.messages.length - 1]?.createdAt;

  const load = useCallback(async () => {
    const res = await fetch(`/api/messages/${id}`, { cache: 'no-store' });
    if (!res.ok) { setMissing(true); return; }
    setView((await res.json()) as ThreadView);
    onChanged();
  }, [id, onChanged]);
  useEffect(() => { void load(); }, [load]);

  const poll = async () => {
    if (!lastAt) return void load();
    const res = await fetch(`/api/messages/${id}?after=${encodeURIComponent(lastAt)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const next = (await res.json()) as ThreadView;
    if (next.messages.length) {
      setView((v) => (v ? { ...next, messages: [...v.messages, ...next.messages.filter((m) => !v.messages.some((x) => x.id === m.id))] } : next));
      onChanged();
    }
  };
  useVisiblePoll(() => void poll(), THREAD_POLL_MS, Boolean(view));

  const older = async () => {
    const first = view?.messages[0]?.createdAt;
    if (!first) return;
    const res = await fetch(`/api/messages/${id}?before=${encodeURIComponent(first)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const page = (await res.json()) as ThreadView;
    setView((v) => (v ? { ...v, hasMore: page.hasMore, messages: [...page.messages, ...v.messages] } : v));
  };

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [view?.messages.length]);

  async function send(attachment: { kind: 'INVOICE'; invoiceId: string } | { kind: 'PAYMENT_LINK'; linkId: string } | null = null) {
    if ((!body.trim() && !attachment) || busy) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/messages/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: attachment ? '' : body, attachment }),
    });
    setBusy(false);
    if (!res.ok) {
      const code = await errorCode(res);
      setErr(t(`errors.${['BLOCKED', 'NOT_ALLOWED', 'RATE_LIMITED', 'INVALID_ATTACHMENT', 'MESSAGING_UNAVAILABLE'].includes(code) ? code : 'GENERIC'}`));
      return;
    }
    const m = (await res.json()) as MessageView;
    if (!attachment) setBody('');
    setView((v) => (v ? { ...v, messages: [...v.messages, m] } : v));
    onChanged();
  }

  async function patch(change: { muted?: boolean; blocked?: boolean }) {
    setMenu(false);
    const res = await fetch(`/api/messages/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) });
    if (res.ok) { await load(); }
  }

  if (missing) return <p className="p-6 text-sm text-muted-foreground">{t('notFound')}</p>;
  if (!view) return <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p>;
  const { summary } = view;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b p-2 sm:p-3">
        <Button type="button" variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={t('back')}>
          <ArrowLeft className="size-5 rtl:rotate-180" />
        </Button>
        <Avatar name={summary.other.name} url={summary.other.avatarUrl} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {summary.other.name}
            {summary.other.badge && <MemberBadge badge={summary.other.badge} />}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {summary.context.title ? t(`context.${summary.context.type}`, { title: summary.context.title }) : t(`role.${summary.other.role}`)}
          </p>
        </div>
        <div className="relative">
          <Button type="button" variant="ghost" size="icon" aria-label={t('menu')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <MoreVertical className="size-5" />
          </Button>
          {menu && (
            <div role="menu" className="absolute end-0 top-11 z-20 w-56 rounded-md border bg-popover p-1 shadow-md">
              <MenuItem icon={summary.muted ? Bell : BellOff} label={summary.muted ? t('unmute') : t('mute')} onClick={() => void patch({ muted: !summary.muted })} />
              <MenuItem icon={Ban} label={summary.blocked ? t('unblock') : t('block')} onClick={() => void patch({ blocked: !summary.blocked })} />
              <MenuItem icon={Flag} label={t('report')} danger onClick={() => { setMenu(false); setReporting(true); }} />
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {view.hasMore && (
          <div className="text-center"><Button type="button" variant="ghost" size="sm" onClick={() => void older()}>{t('older')}</Button></div>
        )}
        {view.messages.map((m, i) => {
          const prev = view.messages[i - 1];
          const day = m.createdAt.slice(0, 10);
          return (
            <div key={m.id} className="space-y-2">
              {(!prev || prev.createdAt.slice(0, 10) !== day) && (
                <p className="text-center text-[11px] text-muted-foreground">{formatDate(m.createdAt, locale, { dateStyle: 'medium' })}</p>
              )}
              <Bubble m={m} threadId={id} ordersPath={ordersPath} canAccept={!canAttach} />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {summary.blocked ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
          <span className="text-muted-foreground">{t('youBlocked', { name: summary.other.name })}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void patch({ blocked: false })}>{t('unblock')}</Button>
        </div>
      ) : (
        <form className="border-t p-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          {err && <p role="alert" className="px-1 pb-1 text-xs text-destructive">{err}</p>}
          <div className="flex items-end gap-2">
            {canAttach && (
              <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t('attach')} onClick={() => setAttaching(true)}>
                <Paperclip className="size-5" />
              </Button>
            )}
            <label htmlFor={`reply-${id}`} className="sr-only">{t('placeholder')}</label>
            <Textarea
              id={`reply-${id}`}
              rows={1}
              maxLength={4000}
              value={body}
              placeholder={t('placeholder')}
              className="max-h-40 min-h-[44px] flex-1 resize-none text-base sm:text-sm"
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
            />
            <Button type="submit" size="icon" className="size-11 shrink-0" loading={busy} disabled={!body.trim()} aria-label={t('send')}>
              <ArrowUp className="size-5" />
            </Button>
          </div>
        </form>
      )}

      {reporting && <ReportDialog id={id} onClose={() => setReporting(false)} />}
      {attaching && <AttachDialog onClose={() => setAttaching(false)} onPick={(a) => { setAttaching(false); void send(a); }} />}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Bell; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={cn('flex min-h-[40px] w-full items-center gap-2 rounded px-2 text-start text-sm hover:bg-muted', danger && 'text-destructive')}>
      <Icon className="size-4" />{label}
    </button>
  );
}

function Bubble({ m, threadId, ordersPath, canAccept }: { m: MessageView; threadId: string; ordersPath: string; canAccept: boolean }) {
  const locale = useLocale() as Locale;
  const time = new Date(m.createdAt).toLocaleTimeString(locale === 'ar' ? 'ar-DZ' : locale, { hour: '2-digit', minute: '2-digit' });
  return (
    <div className={cn('flex flex-col', m.fromMe ? 'items-end' : 'items-start')}>
      {m.body && (
        <p dir="auto" className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm', m.fromMe ? 'rounded-ee-sm bg-primary text-primary-foreground' : 'rounded-es-sm bg-muted')}>
          {m.body}
        </p>
      )}
      {m.attachment && <Card a={m.attachment} fromMe={m.fromMe} threadId={threadId} ordersPath={ordersPath} canAccept={canAccept} />}
      <span className="mt-0.5 text-[10px] text-muted-foreground">{time}</span>
    </div>
  );
}

function Card({ a, fromMe, threadId, ordersPath, canAccept }: { a: AttachmentView; fromMe: boolean; threadId: string; ordersPath: string; canAccept: boolean }) {
  const t = useTranslations('inbox');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (a.kind === 'UNAVAILABLE') return <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('cardUnavailable')}</p>;
  if (a.kind === 'ORDER') {
    return (
      <div className="w-[85%] max-w-xs space-y-1.5 rounded-xl border-2 border-primary-200 bg-card p-3 text-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Package className="size-3.5" />{t('order')} · {a.number}</p>
        <p className="font-medium" dir="auto">{a.title}</p>
        <p className="text-lg font-bold tabular-nums">{formatCurrency(a.total, locale)}</p>
        <p className="text-xs text-muted-foreground">{t(`orderStatus.${a.status}`)}</p>
        <Button asChild size="sm" variant="outline" className="w-full"><Link href={`${ordersPath}/${a.orderId}`}>{t('viewOrder')}</Link></Button>
      </div>
    );
  }
  if (a.kind === 'INVOICE') {
    async function accept() {
      if (a.kind !== 'INVOICE') return;
      setBusy(true);
      setErr(null);
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'DEVIS', conversationId: threadId, invoiceId: a.invoiceId }),
      });
      setBusy(false);
      if (!res.ok) {
        const code = await errorCode(res);
        setErr(t(`orderErrors.${['ALREADY_ORDERED', 'BLOCKED', 'TOO_SMALL'].includes(code) ? code : 'GENERIC'}`));
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`${ordersPath}/${id}`);
    }
    return (
      <div className="w-[85%] max-w-xs space-y-1.5 rounded-xl border bg-card p-3 text-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><FileText className="size-3.5" />{t(`doc.${a.docKind}`)} · {a.number}</p>
        <p className="text-lg font-bold tabular-nums">{formatCurrency(a.total, locale)}</p>
        <a href={`/api/messages/${threadId}/invoice/${a.invoiceId}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] items-center text-sm font-medium text-primary hover:underline">
          {t('viewPdf')}
        </a>
        {canAccept && !fromMe && a.docKind === 'DEVIS' && a.status !== 'CANCELLED' && (
          <>
            <Button type="button" size="sm" className="w-full" loading={busy} onClick={() => void accept()}>{t('acceptDevis')}</Button>
            <p className="text-[11px] text-muted-foreground">{t('acceptDevisHint')}</p>
          </>
        )}
        {err && <p role="alert" className="text-xs text-destructive">{err}</p>}
      </div>
    );
  }
  return (
    <div className="w-[85%] max-w-xs space-y-1.5 rounded-xl border bg-card p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Link2 className="size-3.5" />{t('paymentLink')}</p>
      <p className="font-medium">{a.title}</p>
      <p className="text-lg font-bold tabular-nums">{formatCurrency(a.amount, locale)}</p>
      {a.status !== 'ACTIVE' ? (
        <p className="text-xs text-muted-foreground">{t(`linkStatus.${a.status}`)}</p>
      ) : !fromMe ? (
        <Button asChild size="sm" className="w-full"><Link href={a.payPath}>{t('pay')}</Link></Button>
      ) : null}
    </div>
  );
}

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('inbox');
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number]>('SPAM');
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  async function submit() {
    setState('busy');
    const res = await fetch(`/api/messages/${id}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, note: note.trim() || null }),
    });
    setState(res.ok ? 'done' : 'error');
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={SHEET_CONTENT_CLASS}>
        <DialogHeader><DialogTitle>{t('reportTitle')}</DialogTitle></DialogHeader>
        {state === 'done' ? (
          <div className="space-y-4">
            <p className="text-sm">{t('reportDone')}</p>
            <Button type="button" className="w-full" onClick={onClose}>{t('close')}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('reportBody')}</p>
            <fieldset className="space-y-2">
              <legend className="sr-only">{t('reportReason')}</legend>
              {REPORT_REASONS.map((r) => (
                <label key={r} className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
                  <input type="radio" name="reason" className="size-4" checked={reason === r} onChange={() => setReason(r)} />
                  {t(`reasons.${r}`)}
                </label>
              ))}
            </fieldset>
            <Textarea rows={3} maxLength={1000} value={note} placeholder={t('reportNote')} className="text-base sm:text-sm" onChange={(e) => setNote(e.target.value)} />
            {state === 'error' && <p role="alert" className="text-sm text-destructive">{t('errors.GENERIC')}</p>}
            <Button type="button" variant="destructive" className="w-full" loading={state === 'busy'} onClick={() => void submit()}>{t('reportSend')}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface Attachables {
  invoices: { id: string; docKind: 'FACTURE' | 'PROFORMA' | 'DEVIS'; number: string; total: number; client: string | null }[];
  links: { id: string; title: string; amount: number }[];
}

function AttachDialog({ onClose, onPick }: { onClose: () => void; onPick: (a: { kind: 'INVOICE'; invoiceId: string } | { kind: 'PAYMENT_LINK'; linkId: string }) => void }) {
  const t = useTranslations('inbox');
  const locale = useLocale() as Locale;
  const [items, setItems] = useState<Attachables | null>(null);
  useEffect(() => {
    void fetch('/api/messages/attachables').then(async (r) => setItems(r.ok ? ((await r.json()) as Attachables) : { invoices: [], links: [] }));
  }, []);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={SHEET_CONTENT_CLASS}>
        <DialogHeader><DialogTitle>{t('attachTitle')}</DialogTitle></DialogHeader>
        {!items ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : items.invoices.length + items.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('attachEmpty')}</p>
        ) : (
          <div className="max-h-[60dvh] space-y-4 overflow-y-auto">
            {items.links.length > 0 && (
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{t('paymentLinks')}</h3>
                {items.links.map((l) => (
                  <button key={l.id} type="button" onClick={() => onPick({ kind: 'PAYMENT_LINK', linkId: l.id })} className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border px-3 text-start text-sm hover:bg-muted">
                    <span className="truncate">{l.title}</span><span className="shrink-0 tabular-nums">{formatCurrency(l.amount, locale)}</span>
                  </button>
                ))}
              </section>
            )}
            {items.invoices.length > 0 && (
              <section className="space-y-1">
                <h3 className="text-xs font-semibold text-muted-foreground">{t('documents')}</h3>
                {items.invoices.map((i) => (
                  <button key={i.id} type="button" onClick={() => onPick({ kind: 'INVOICE', invoiceId: i.id })} className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border px-3 text-start text-sm hover:bg-muted">
                    <span className="min-w-0"><span className="block truncate">{t(`doc.${i.docKind}`)} · {i.number}</span>{i.client && <span className="block truncate text-xs text-muted-foreground">{i.client}</span>}</span>
                    <span className="shrink-0 tabular-nums">{formatCurrency(i.total, locale)}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
