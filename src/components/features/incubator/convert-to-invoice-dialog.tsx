'use client';

/**
 * « Convertir en facture » — one confirmation, then a real facture.
 *
 * Everything is copied from the proforma / devis on the server; the host only
 * confirms what changes when it becomes a facture: the number it will take,
 * today's date, how it is actually paid, and the stamp. A client with an
 * empty legal block is flagged here, while it can still be fixed.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { clientLegalGap } from '@/lib/client-legal-gap';
import { formatDZD } from '@/server/invoices/engine';
import type { InvoicePaymentMethod, InvoiceRecord } from '@/server/db/store';

interface Props {
  source: InvoiceRecord | null;
  /** « 15/2026 » — the facture number it will take (a preview; the server allocates). */
  nextNumber: string;
  hasStamp: boolean;
  onOpenChange: (open: boolean) => void;
  /** The new facture and the now-locked source. */
  onConverted: (invoice: InvoiceRecord, source: InvoiceRecord) => void;
}

const METHODS: Array<{ id: InvoicePaymentMethod; key: 'methodEspece' | 'methodCheque' | 'methodVirement' }> = [
  { id: 'ESPECE', key: 'methodEspece' },
  { id: 'CHEQUE', key: 'methodCheque' },
  { id: 'VIREMENT', key: 'methodVirement' },
];

export function ConvertToInvoiceDialog({ source, nextNumber, hasStamp, onOpenChange, onConverted }: Props) {
  const t = useTranslations('incubator.invoicesPage');
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('ESPECE');
  const [withStamp, setWithStamp] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<InvoiceRecord | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Reset to the source's own choices each time a different one is opened.
  if (source && loadedFor !== source.id) {
    setLoadedFor(source.id);
    setPaymentMethod(source.paymentMethod);
    setWithStamp(hasStamp && Boolean(source.withStamp));
    setNote(source.note ?? '');
    setError(null);
    setDone(null);
  }

  const snap = source?.clientSnapshot;
  const gap = snap ? clientLegalGap({ ...snap, fullName: snap.name }) : null;

  async function convert() {
    if (!source) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/incubator/invoices/${source.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentMethod, withStamp: hasStamp && withStamp, note: note.trim() || null }),
      });
      const body = await res.json().catch(() => null) as
        { invoice?: InvoiceRecord; source?: InvoiceRecord; error?: { message?: string } } | null;
      if (!res.ok || !body?.invoice || !body.source) {
        setError(body?.error?.message ?? t('actionFailed'));
        return;
      }
      setDone(body.invoice);
      onConverted(body.invoice, body.source);
    } catch {
      setError(t('actionFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={source !== null} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        {done ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2 className="size-10 text-primary" />
            <p className="text-lg font-semibold">{t('convertDone', { number: done.number })}</p>
            <p className="text-sm text-muted-foreground">{t('convertDoneHint')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <a href={`/api/incubator/invoices/${done.id}/pdf`} download>
                  <Download className="size-4" /> {t('convertDownload')}
                </a>
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('convertClose')}</Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('convertTitle', { number: source?.number ?? '' })}</DialogTitle>
              <DialogDescription>{t('convertDescription')}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">{t('convertNumber')}</dt>
              <dd className="font-semibold tabular-nums">{nextNumber}</dd>
              <dt className="text-muted-foreground">{t('convertDate')}</dt>
              <dd className="tabular-nums">{new Date().toLocaleDateString('fr-DZ')}</dd>
              <dt className="text-muted-foreground">{t('colClient')}</dt>
              <dd className="truncate">{snap?.legalName ?? snap?.name}</dd>
              <dt className="text-muted-foreground">{t('convertBase')}</dt>
              <dd className="tabular-nums">{source ? formatDZD(source.totals.ttc) : ''}</dd>
            </dl>

            {gap && (
              <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t('convertLegalGap')}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="convert-method">{t('colMethod')}</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as InvoicePaymentMethod)}>
                <SelectTrigger id="convert-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => <SelectItem key={m.id} value={m.id}>{t(m.key)}</SelectItem>)}
                </SelectContent>
              </Select>
              {paymentMethod === 'ESPECE' && <p className="text-xs text-muted-foreground">{t('convertTimbre')}</p>}
            </div>

            {hasStamp && (
              <label className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox" className="size-4 accent-primary" checked={withStamp}
                  aria-label={t('convertStamp')} onChange={(e) => setWithStamp(e.target.checked)}
                />
                {t('convertStamp')}
              </label>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="convert-note">{t('convertNote')}</Label>
              <textarea
                id="convert-note" rows={3} maxLength={600} value={note} dir="auto"
                onChange={(e) => setNote(e.target.value)} placeholder={t('convertNotePlaceholder')}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">{t('convertNoteHint')}</p>
            </div>

            <p className="text-xs text-muted-foreground">{t('convertKeeps', { number: source?.number ?? '' })}</p>
            {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('convertCancel')}</Button>
              <Button onClick={() => void convert()} loading={saving}>{t('convertConfirm', { number: nextNumber })}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
