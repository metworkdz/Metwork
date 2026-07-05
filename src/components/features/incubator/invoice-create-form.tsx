'use client';

/**
 * Invoice creation form.
 *
 * The live summary panel imports computeInvoiceTotals / formatDZD /
 * amountToFrenchWords from the canonical engine (client-safe: pure functions,
 * type-only store imports) so the on-screen totals are BY CONSTRUCTION the
 * exact numbers the API stores and the PDF prints.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, Plus, Trash2, UserPlus,
} from 'lucide-react';
import { Link, useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ClientSelector, type ClientHit } from './client-selector';
import { ClientFormDialog, type CreatedClient } from './client-form-dialog';
import { safeUUID } from '@/lib/safe-uuid';
import {
  computeInvoiceTotals, formatDZD, amountToFrenchWords,
} from '@/server/invoices/engine';
import type { InvoicePaymentMethod, InvoiceRecord, InvoiceTemplate } from '@/server/db/store';

interface LineDraft {
  key: string;
  designation: string;
  quantity: string;
  unitPriceHt: string;
}

interface Props {
  defaultVatRate: number;
  defaultTemplate: InvoiceTemplate;
  serviceNames: string[];
  legalComplete: boolean;
  hasBankRib: boolean;
}

function emptyLine(): LineDraft {
  return { key: safeUUID(), designation: '', quantity: '1', unitPriceHt: '' };
}

export function InvoiceCreateForm({
  defaultVatRate,
  defaultTemplate,
  serviceNames,
  legalComplete,
  hasBankRib,
}: Props) {
  const t = useTranslations('incubator.invoiceForm');
  const router = useRouter();

  const [client, setClient] = useState<ClientHit | null>(null);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>('ESPECE');
  const [template, setTemplate] = useState<InvoiceTemplate>(defaultTemplate);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvoiceRecord | null>(null);

  const parsedLines = useMemo(() => lines
    .map((l) => ({
      designation: l.designation.trim(),
      quantity: Number(l.quantity),
      unitPriceHt: Number(l.unitPriceHt),
    }))
    .filter((l) =>
      l.designation.length > 0 &&
      Number.isFinite(l.quantity) && l.quantity > 0 &&
      Number.isFinite(l.unitPriceHt) && l.unitPriceHt >= 0,
    ), [lines]);

  const parsedVat = Number(vatRate);
  const vatValid = Number.isFinite(parsedVat) && parsedVat >= 0 && parsedVat <= 100;

  // SAME math as the API + PDF — imported from the canonical engine.
  const totals = useMemo(
    () => computeInvoiceTotals(parsedLines, vatValid ? parsedVat : 0, paymentMethod),
    [parsedLines, parsedVat, vatValid, paymentMethod],
  );
  const showTimbre = paymentMethod === 'ESPECE';
  const wordsPreview = parsedLines.length > 0 ? amountToFrenchWords(totals.net) : null;

  const needsBankRib = paymentMethod === 'VIREMENT' && !hasBankRib;
  const canSubmit =
    legalComplete && !needsBankRib && client !== null &&
    parsedLines.length > 0 && parsedLines.length === lines.length && vatValid;

  function setLine(key: string, patch: Partial<LineDraft>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function handleClientCreated(record: CreatedClient) {
    setClient({
      id: record.id,
      fullName: record.fullName,
      email: record.email,
      phone: record.phone,
      companyName: record.companyName,
      clientType: record.clientType,
      legalName: record.legalName,
      address: record.address,
      rc: record.rc,
      nif: record.nif,
      nis: record.nis,
      ai: record.ai,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !client) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/incubator/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          lines: parsedLines,
          vatRate: parsedVat,
          paymentMethod,
          template,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d.error?.message ?? t('errorSubmit'));
        return;
      }
      const invoice = await res.json() as InvoiceRecord;
      setCreated(invoice);
    } catch {
      setError(t('errorNetwork'));
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Success state: invoice issued, offer the PDF ── */
  if (created) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="size-10 text-primary" />
          <div>
            <p className="text-lg font-semibold">{t('successTitle', { number: created.number })}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('successSubtitle', { net: formatDZD(created.totals.net) })}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button asChild>
              <a href={`/api/incubator/invoices/${created.id}/pdf`} download>
                <Download className="size-4" />
                {t('downloadPdf')}
              </a>
            </Button>
            <Button variant="outline" onClick={() => router.push('/dashboard/incubator/invoices')}>
              {t('backToList')}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const clientPreviewLines: string[] = client ? [
    ...(client.clientType === 'COMPANY' && client.legalName ? [client.legalName] : []),
    ...(client.address ? [client.address] : []),
    ...(client.rc ? [`RC: ${client.rc}`] : []),
    ...(client.nif ? [`NIF: ${client.nif}`] : []),
    ...(client.nis ? [`NIS: ${client.nis}`] : []),
    ...(client.ai ? [`AI: ${client.ai}`] : []),
    ...(client.phone ? [`${t('previewPhone')}: ${client.phone}`] : []),
    ...(client.email ? [client.email] : []),
  ] : [];

  return (
    <form onSubmit={(e) => void handleSubmit(e)}>
      {/* Datalist feeding the designation inputs with the services catalog. */}
      <datalist id="invoice-service-names">
        {serviceNames.map((name) => <option key={name} value={name} />)}
      </datalist>

      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="-ms-2 text-muted-foreground">
          <Link href="/dashboard/incubator/invoices">
            <ArrowLeft className="size-4" />
            {t('backToList')}
          </Link>
        </Button>
      </div>

      {!legalComplete && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {t('legalIncomplete')}{' '}
            <Link href="/dashboard/incubator/settings" className="font-medium underline underline-offset-2">
              {t('goToSettings')}
            </Link>
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ═══════════ Left column — form ═══════════ */}
        <div className="space-y-6">
          {/* ── Client ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('sectionClient')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <ClientSelector
                    value={client}
                    onSelect={setClient}
                    placeholder={t('clientSearchPlaceholder')}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setNewClientOpen(true)}
                >
                  <UserPlus className="size-4" />
                  {t('newClient')}
                </Button>
              </div>
              <ClientFormDialog
                open={newClientOpen}
                onOpenChange={setNewClientOpen}
                onSaved={() => setNewClientOpen(false)}
                onCreated={handleClientCreated}
              />

              {client && (
                <div className="rounded-lg border border-border bg-muted/30 p-3.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="text-sm font-semibold">{client.fullName}</p>
                    <Badge variant="outline" className="text-xs">
                      {client.clientType === 'INDIVIDUAL' ? t('typeIndividual') : t('typeCompany')}
                    </Badge>
                  </div>
                  {clientPreviewLines.length > 0 ? (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {clientPreviewLines.map((line) => <p key={line}>{line}</p>)}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t('noLegalInfo')}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Lines ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('sectionLines')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="hidden grid-cols-[1fr_90px_130px_36px] gap-2 sm:grid">
                <Label className="text-xs text-muted-foreground">{t('colDesignation')}</Label>
                <Label className="text-xs text-muted-foreground">{t('colQuantity')}</Label>
                <Label className="text-xs text-muted-foreground">{t('colUnitPrice')}</Label>
                <span />
              </div>
              {lines.map((line) => (
                <div key={line.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_90px_130px_36px]">
                  <Input
                    list="invoice-service-names"
                    value={line.designation}
                    onChange={(e) => setLine(line.key, { designation: e.target.value })}
                    placeholder={t('designationPlaceholder')}
                    maxLength={300}
                    required
                  />
                  <Input
                    type="number"
                    min="0.01"
                    step="any"
                    value={line.quantity}
                    onChange={(e) => setLine(line.key, { quantity: e.target.value })}
                    placeholder="1"
                    required
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.unitPriceHt}
                    onChange={(e) => setLine(line.key, { unitPriceHt: e.target.value })}
                    placeholder={t('unitPricePlaceholder')}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="justify-self-end text-muted-foreground hover:text-destructive"
                    disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                    title={t('removeLine')}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
              >
                <Plus className="size-4" />
                {t('addLine')}
              </Button>
            </CardContent>
          </Card>

          {/* ── Payment & template ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('sectionPayment')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="inv-vat">{t('labelVat')}</Label>
                <Input
                  id="inv-vat"
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  className="mt-1"
                  value={vatRate}
                  onChange={(e) => setVatRate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label>{t('labelMethod')}</Label>
                <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as InvoicePaymentMethod)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ESPECE">{t('methodEspece')}</SelectItem>
                    <SelectItem value="CHEQUE">{t('methodCheque')}</SelectItem>
                    <SelectItem value="VIREMENT">{t('methodVirement')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('labelTemplate')}</Label>
                <Select value={template} onValueChange={(v) => setTemplate(v as InvoiceTemplate)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CLASSIC">{t('templateClassic')}</SelectItem>
                    <SelectItem value="GREEN_BAND">{t('templateGreenBand')}</SelectItem>
                    <SelectItem value="MINIMAL">{t('templateMinimal')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {needsBankRib && (
                <div className="sm:col-span-3 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>
                    {t('bankMissing')}{' '}
                    <Link href="/dashboard/incubator/settings" className="font-medium underline underline-offset-2">
                      {t('goToSettings')}
                    </Link>
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══════════ Right column — live summary ═══════════ */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('sectionSummary')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{t('totalHt')}</dt>
                  <dd className="tabular-nums font-medium">{formatDZD(totals.ht)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">
                    {t('tva')} {vatValid ? `(${parsedVat}%)` : ''}
                  </dt>
                  <dd className="tabular-nums font-medium">{formatDZD(totals.tva)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">{t('totalTtc')}</dt>
                  <dd className="tabular-nums font-medium">{formatDZD(totals.ttc)}</dd>
                </div>
                {showTimbre && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">{t('timbre')}</dt>
                    <dd className="tabular-nums font-medium">{formatDZD(totals.timbre)}</dd>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-border pt-2.5">
                  <dt className="font-semibold">{t('netToPay')}</dt>
                  <dd className="tabular-nums text-lg font-bold text-primary">{formatDZD(totals.net)}</dd>
                </div>
              </dl>

              {wordsPreview && (
                <p className="rounded-md bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {wordsPreview}
                </p>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
                {t('submit')}
              </Button>
              {!client && (
                <p className="text-center text-xs text-muted-foreground">{t('selectClientFirst')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}
