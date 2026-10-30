'use client';

/**
 * Refund queue. [Accept] undoes the sale on the owner side and decides where
 * the client is paid (wallet now, or a guest's emailed account link); once a
 * guest's account is in, [Mark as paid] records the manual transfer and its
 * receipt. Every action is idempotent server-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import type { PayoutAccount, RefundStatus } from '@/server/db/store';
import type { RefundRow } from '@/server/refunds/service';
import { formatAmount, formatDate } from './types';

const STATUS_VARIANT: Record<RefundStatus, 'warning' | 'outline' | 'success' | 'danger' | 'default'> = {
  REQUESTED: 'warning', AWAITING_ACCOUNT: 'default', READY_TO_PAY: 'warning', REFUNDED: 'success', REJECTED: 'danger',
};

type Dialogs =
  | { kind: 'accept' | 'reject' | 'paid'; row: RefundRow; account?: PayoutAccount | null }
  | null;

async function api(url: string, init?: RequestInit): Promise<{ ok: boolean; message?: string; body?: unknown }> {
  const res = await fetch(url, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, body, message: (body as { error?: { message?: string } } | null)?.error?.message };
}

export function RefundsTab() {
  const t = useTranslations('refunds.admin');
  const [rows, setRows] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [text, setText] = useState('');
  const [reference, setReference] = useState('');
  const [receipt, setReceipt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(false);
    const r = await api('/api/admin/refunds');
    if (!r.ok) setError(true);
    else setRows((r.body as { refunds: RefundRow[] }).refunds);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function open(kind: 'accept' | 'reject' | 'paid', row: RefundRow) {
    setDialog({ kind, row });
    setText(''); setReference(''); setReceipt(null); setFormError(null);
    if (kind === 'paid') {
      void api(`/api/admin/refunds/${row.id}/account`).then((r) => {
        if (r.ok) setDialog({ kind, row, account: (r.body as { account: PayoutAccount }).account });
      });
    }
  }

  async function uploadReceipt(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('folder', 'refund-receipts');
      const res = await fetch('/api/upload', { method: 'POST', credentials: 'include', body: form });
      const body = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!res.ok || !body?.url) throw new Error();
      setReceipt(body.url);
    } catch {
      setFormError(t('errGeneric'));
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    if (!dialog) return;
    setBusy(true);
    setFormError(null);
    const payload =
      dialog.kind === 'accept' ? { action: 'accept', adminNote: text.trim() || undefined }
      : dialog.kind === 'reject' ? { action: 'reject', reason: text.trim() }
      : { action: 'paid', transferReference: reference.trim() || undefined, receiptUrl: receipt ?? undefined };
    const r = await api(`/api/admin/refunds/${dialog.row.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    setBusy(false);
    if (!r.ok) { setFormError(r.message ?? t('errGeneric')); return; }
    setDialog(null);
    await load();
  }

  async function resend(row: RefundRow) {
    const r = await api(`/api/admin/refunds/${row.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'resend' }) });
    setFlash(r.ok ? t('resent') : r.message ?? t('errGeneric'));
    await load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">…</p>;
  if (error) return <InlineEmptyState title={t('loadError')} />;

  const row = dialog?.row;
  const p = row?.preview;

  return (
    <div className="space-y-4">
      {flash && <p className="text-sm text-muted-foreground" role="status">{flash}</p>}
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <InlineEmptyState title={t('emptyRefunds')} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colOpened')}</TableHead>
                    <TableHead>{t('colClient')}</TableHead>
                    <TableHead>{t('colItem')}</TableHead>
                    <TableHead className="text-end">{t('colAmount')}</TableHead>
                    <TableHead>{t('colDestination')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(r.createdAt)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{r.clientName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{t(`by_${r.requestedBy}`)}</div>
                      </TableCell>
                      <TableCell>
                        <div>{r.itemName}</div>
                        {r.reason && <div className="max-w-xs truncate text-xs text-muted-foreground" title={r.reason}>{r.reason}</div>}
                      </TableCell>
                      <TableCell className="text-end tabular-nums">{formatAmount(r.amount)}</TableCell>
                      <TableCell className="text-sm">
                        {t(`dest${r.destination}`)}
                        {r.accountMasked && <div className="font-mono text-xs text-muted-foreground">{r.accountType?.toUpperCase()} {r.accountMasked}</div>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[r.status]}>{t(`rs_${r.status}`)}</Badge>
                        {r.paidOffPlatform && <div className="mt-1 text-xs text-muted-foreground">{t('offPlatform')}</div>}
                        {r.linkExpired && <div className="mt-1 text-xs text-destructive">{t('linkExpired')}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex flex-wrap justify-end gap-2">
                          {r.status === 'REQUESTED' && (
                            <>
                              <Button size="sm" onClick={() => open('accept', r)}>{t('accept')}</Button>
                              <Button size="sm" variant="outline" onClick={() => open('reject', r)}>{t('reject')}</Button>
                            </>
                          )}
                          {r.status === 'AWAITING_ACCOUNT' && (
                            <Button size="sm" variant="outline" onClick={() => void resend(r)}>{t('resend')}</Button>
                          )}
                          {r.status === 'READY_TO_PAY' && (
                            <Button size="sm" onClick={() => open('paid', r)}>{t('markPaid')}</Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o && !busy) setDialog(null); }}>
        <DialogContent>
          {dialog && row && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {dialog.kind === 'accept' ? t('acceptTitle') : dialog.kind === 'reject' ? t('rejectTitle') : t('paidTitle')}
                </DialogTitle>
                <DialogDescription>
                  {dialog.kind === 'paid'
                    ? t('paidIntro', { amount: formatAmount(row.amount) })
                    : t('acceptIntro', { amount: formatAmount(row.amount), item: row.itemName })}
                </DialogDescription>
              </DialogHeader>

              {dialog.kind === 'accept' && (
                <ul className="list-disc space-y-1 ps-5 text-sm">
                  <li>{p?.destination === 'WALLET' ? t('acceptWallet') : t('acceptBank')}</li>
                  {p?.ownerKind === 'INCUBATOR' && p.ownerDebit > 0 && <li>{t('acceptOwnerIncubator', { amount: formatAmount(p.ownerDebit) })}</li>}
                  {p?.ownerKind === 'MENTOR' && p.ownerDebit > 0 && <li>{t('acceptOwnerMentor', { amount: formatAmount(p.ownerDebit) })}</li>}
                  {p?.ownerKind === 'MENTOR' && p.mentorAvailable != null && p.ownerDebit > p.mentorAvailable && (
                    <li className="text-amber-700">{t('acceptMentorDebt', { available: formatAmount(p.mentorAvailable), debt: formatAmount(p.ownerDebit - p.mentorAvailable) })}</li>
                  )}
                </ul>
              )}

              {dialog.kind === 'paid' && (
                <div className="space-y-3 text-sm">
                  {dialog.account && (
                    <div className="rounded-md border border-border bg-muted/40 p-3">
                      <div className="text-xs text-muted-foreground">{t('paidAccount')} ({dialog.account.accountType.toUpperCase()})</div>
                      <div className="select-all font-mono text-base">{dialog.account.accountNumber}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t('paidHolder')}</div>
                      <div className="select-all">{dialog.account.holderName}</div>
                    </div>
                  )}
                  <Input id="refund-reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('paidReference')} />
                  <label className="block text-xs text-muted-foreground" htmlFor="refund-receipt">{t('paidReceipt')}</label>
                  <input
                    id="refund-receipt" type="file" accept="image/*" className="block w-full text-sm"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReceipt(f); }}
                  />
                  {uploading && <p className="text-xs text-muted-foreground">{t('uploading')}</p>}
                  {receipt && <p className="truncate text-xs text-green-700">{receipt}</p>}
                </div>
              )}

              {dialog.kind !== 'paid' && (
                <Textarea
                  id="refund-dialog-text" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={dialog.kind === 'reject' ? t('rejectReason') : t('acceptNote')}
                />
              )}

              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <DialogFooter>
                <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>{t('cancel')}</Button>
                <Button
                  variant={dialog.kind === 'reject' ? 'destructive' : 'default'}
                  disabled={busy || uploading || (dialog.kind === 'reject' && text.trim().length < 3)}
                  onClick={() => void submit()}
                >
                  {busy ? t('saving') : dialog.kind === 'accept' ? t('acceptConfirm') : dialog.kind === 'reject' ? t('rejectConfirm') : t('paidConfirm')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
