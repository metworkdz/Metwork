'use client';

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Check, Copy, Link2, Loader2, PlusCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';

type PaymentLinkStatus = 'ACTIVE' | 'PAID' | 'EXPIRED' | 'CANCELLED';

interface PaymentLinkRow {
  id: string;
  serviceName: string;
  amount: number;
  description: string | null;
  slug: string;
  status: PaymentLinkStatus;
  hasExpiry: boolean;
  expiresAt: string | null;
  payerName: string | null;
  createdAt: string;
}

const STATUS_VARIANT: Record<PaymentLinkStatus, 'success' | 'primary' | 'warning' | 'default'> = {
  ACTIVE: 'success',
  PAID: 'primary',
  EXPIRED: 'warning',
  CANCELLED: 'default',
};

/* ── Create dialog ── */
function CreateLinkDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations('incubator.paymentLinks');
  const [open, setOpen] = useState(false);
  const [submitting, setSub] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDesc] = useState('');
  const [hasExpiry, setHasExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');

  function reset() {
    setServiceName(''); setAmount(''); setDesc('');
    setHasExpiry(false); setExpiresAt(''); setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt < 50) { setError(t('errorAmount')); return; }
    if (hasExpiry && !expiresAt) { setError(t('errorExpiry')); return; }

    setSub(true);
    try {
      const res = await fetch('/api/incubator/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceName: serviceName.trim(),
          amount: amt,
          description: description.trim() || null,
          hasExpiry,
          expiresAt: hasExpiry ? new Date(expiresAt).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { message?: string };
        setError(d.message ?? t('errorGeneric'));
        return;
      }
      onCreated(); setOpen(false); reset();
    } catch {
      setError(t('errorNetwork'));
    } finally {
      setSub(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusCircle className="size-4" />
          {t('addLink')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
          <div>
            <Label htmlFor="pl-name">{t('labelService')}</Label>
            <Input
              id="pl-name"
              className="mt-1"
              value={serviceName}
              onChange={(e) => setServiceName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
            />
          </div>
          <div>
            <Label htmlFor="pl-amount">{t('labelAmount')}</Label>
            <Input
              id="pl-amount"
              type="number"
              inputMode="numeric"
              className="mt-1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              min={50}
              step={1}
            />
          </div>
          <div>
            <Label htmlFor="pl-desc">{t('labelDescription')}</Label>
            <textarea
              id="pl-desc"
              className="mt-1 min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={description}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={2000}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="pl-expiry"
              type="checkbox"
              className="size-4 rounded border-input"
              checked={hasExpiry}
              onChange={(e) => setHasExpiry(e.target.checked)}
            />
            <Label htmlFor="pl-expiry" className="cursor-pointer">{t('labelHasExpiry')}</Label>
          </div>
          {hasExpiry && (
            <div>
              <Label htmlFor="pl-expires">{t('labelExpiresAt')}</Label>
              <Input
                id="pl-expires"
                type="datetime-local"
                className="mt-1"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                required={hasExpiry}
              />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" loading={submitting}>{t('create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Per-row copy button ── */
function CopyLinkButton({ url, label }: { url: string; label: string }) {
  const t = useTranslations('incubator.paymentLinks');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked — fall back to a prompt the user can copy from.
      window.prompt(label, url);
    }
  }

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copy()}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t('copied') : t('copy')}
    </Button>
  );
}

export function PaymentLinksManager() {
  const t = useTranslations('incubator.paymentLinks');
  const locale = useLocale();
  const [rows, setRows] = useState<PaymentLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); }, []);

  async function fetchLinks() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/incubator/payment-links', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load payment links');
      const data = (await res.json()) as { items: PaymentLinkRow[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading payment links');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void fetchLinks(); }, []);

  async function handleCancel(row: PaymentLinkRow) {
    if (!confirm(t('confirmCancel', { service: row.serviceName }))) return;
    await fetch(`/api/incubator/payment-links/${row.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    });
    void fetchLinks();
  }

  const payUrl = (slug: string) => `${origin}/${locale}/pay/${slug}`;
  const fmtAmount = (n: number) => `${n.toLocaleString()} DZD`;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="me-2 size-5 animate-spin" />
        {t('loading')}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        {fetchError}
      </div>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-3">
        <p className="text-sm text-muted-foreground">{t('count', { count: rows.length })}</p>
        <CreateLinkDialog onCreated={() => void fetchLinks()} />
      </div>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <InlineEmptyState
            title={t('emptyTitle')}
            description={t('emptyDescription')}
            icon={<Link2 className="size-5 text-muted-foreground" />}
            action={<CreateLinkDialog onCreated={() => void fetchLinks()} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colService')}</TableHead>
                  <TableHead>{t('colAmount')}</TableHead>
                  <TableHead>{t('colStatus')}</TableHead>
                  <TableHead className="text-end">{t('colActions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.serviceName}</div>
                      {row.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{row.description}</div>
                      )}
                    </TableCell>
                    <TableCell>{fmtAmount(row.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[row.status]}>{t(`status.${row.status}`)}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {row.status === 'ACTIVE' && (
                          <>
                            <CopyLinkButton url={payUrl(row.slug)} label={t('copy')} />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="gap-1.5 text-destructive hover:text-destructive"
                              onClick={() => void handleCancel(row)}
                            >
                              <XCircle className="size-3.5" />
                              {t('cancel')}
                            </Button>
                          </>
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
  );
}
