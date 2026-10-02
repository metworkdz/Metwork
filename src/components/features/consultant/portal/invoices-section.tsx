'use client';

/**
 * Facturation — the consultant issues their own factures, proformas and devis.
 *
 * Three views behind one tab: the documents themselves, the client book, and
 * the legal letterhead every document is built from. They are one section
 * rather than three tabs because a consultant arrives here to do one thing,
 * and the first time they arrive the only thing they CAN do is fill in the
 * letterhead — which is why an incomplete one takes over the documents view.
 *
 * The totals shown while typing come from the same engine the server uses to
 * compute the stored ones (`@/server/invoices/engine` is client-safe by
 * design); nothing here recomputes money its own way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Plus, Search, Trash2, X } from 'lucide-react';
import {
  consultantService,
  type ConsultantClient,
  type ConsultantInvoice,
  type ConsultantInvoiceKind,
  type ConsultantInvoiceList,
  type ConsultantInvoiceSettingsDto,
} from '@/services/consultant.service';
import { computeInvoiceTotals, formatDZD } from '@/server/invoices/engine';
import {
  BrandButton, EmptyBlock, ErrorBanner, Field, FlowSheet, GhostButton,
  SectionCard, SectionHeading, Spinner, cpInputClassLight, uploadConsultantFile,
} from './shared';
import { cn } from '@/lib/utils';

type View = 'documents' | 'clients' | 'settings';
type KindFilter = 'ALL' | ConsultantInvoiceKind;

const KINDS: ConsultantInvoiceKind[] = ['FACTURE', 'PROFORMA', 'DEVIS'];

/** Today + 30 days, "YYYY-MM-DD" — the default validity of a devis. */
function defaultValidUntil(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

export function InvoicesSection() {
  const t = useTranslations('consultantPortal.invoices');
  const [view, setView] = useState<View>('documents');
  const [data, setData] = useState<ConsultantInvoiceList | null>(null);
  const [settings, setSettings] = useState<ConsultantInvoiceSettingsDto | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(false);
      const [list, s] = await Promise.all([
        consultantService.invoices(),
        consultantService.invoiceSettings(),
      ]);
      setData(list);
      setSettings(s);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (failed) {
    return (
      <section>
        <SectionHeading title={t('heading')} />
        <SectionCard><ErrorBanner tone="light" message={t('loadFailed')} /></SectionCard>
      </section>
    );
  }
  if (!data || !settings) {
    return (
      <section>
        <SectionHeading title={t('heading')} />
        <SectionCard><div className="flex justify-center py-8"><Spinner tone="light" /></div></SectionCard>
      </section>
    );
  }

  const views: Array<{ key: View; label: string }> = [
    { key: 'documents', label: t('tabDocuments') },
    { key: 'clients', label: t('tabClients') },
    { key: 'settings', label: t('tabSettings') },
  ];

  return (
    <section>
      <SectionHeading title={t('heading')} subtitle={t('subtitle')} />

      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setView(v.key)}
            aria-current={view === v.key ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors',
              view === v.key
                ? 'border-foreground bg-foreground text-background font-medium'
                : 'border-border bg-card text-muted-foreground',
            )}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'documents' && <DocumentsView data={data} settings={settings} onChanged={load} />}
      {view === 'clients' && <ClientsView />}
      {view === 'settings' && <SettingsView settings={settings} onSaved={load} />}
    </section>
  );
}

/* ═══════════════════ Documents ═══════════════════ */

function DocumentsView({
  data, settings, onChanged,
}: {
  data: ConsultantInvoiceList;
  settings: ConsultantInvoiceSettingsDto;
  onChanged: () => void | Promise<void>;
}) {
  const t = useTranslations('consultantPortal.invoices');
  const [filter, setFilter] = useState<KindFilter>('ALL');
  const [creating, setCreating] = useState(false);

  const shown = data.items.filter((i) => filter === 'ALL' || (i.kind ?? 'FACTURE') === filter);

  return (
    <div className="flex flex-col gap-3">
      {!settings.complete && (
        <SectionCard className="border-destructive/30 bg-destructive/5">
          <p className="text-sm font-semibold text-destructive">{t('incompleteTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('incompleteBody')}</p>
        </SectionCard>
      )}

      <BrandButton
        tone="light"
        onClick={() => setCreating(true)}
        disabled={!settings.complete}
        className="w-full"
      >
        <Plus className="size-4" /> {t('newDocument')}
      </BrandButton>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {(['ALL', ...KINDS] as KindFilter[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
              filter === k ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground',
            )}
          >
            {k === 'ALL' ? t('filterAll') : t(`kind${k}` as 'kindFACTURE')}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <SectionCard><EmptyBlock>{t('empty')}</EmptyBlock></SectionCard>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((inv) => <DocumentRow key={inv.id} invoice={inv} onChanged={onChanged} />)}
        </div>
      )}

      {creating && (
        <CreateSheet
          nextSeq={data.nextSeq}
          defaultVatRate={settings.issuer.defaultVatRate}
          canTransfer={settings.canInvoiceByTransfer}
          onClose={() => setCreating(false)}
          onIssued={async () => { setCreating(false); await onChanged(); }}
        />
      )}
    </div>
  );
}

function DocumentRow({ invoice, onChanged }: { invoice: ConsultantInvoice; onChanged: () => void | Promise<void> }) {
  const t = useTranslations('consultantPortal.invoices');
  const [busy, setBusy] = useState(false);
  const kind = invoice.kind ?? 'FACTURE';
  const cancelled = invoice.status === 'CANCELLED';

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={cn('font-mono text-sm font-medium', cancelled && 'line-through opacity-60')}>
            {invoice.number}
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {invoice.clientSnapshot.legalName || invoice.clientSnapshot.name}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {t(`kind${kind}` as 'kindFACTURE')}
          </span>
          <span className="text-sm font-semibold tabular-nums">{formatDZD(invoice.totals.net)}</span>
        </div>
      </div>
      <div className="mt-2.5 flex gap-2">
        <GhostButton
          tone="light"
          onClick={() => window.open(consultantService.invoicePdfPath(invoice.id), '_blank', 'noopener')}
        >
          <Download className="size-3.5" /> {t('downloadPdf')}
        </GhostButton>
        {!cancelled && (
          <GhostButton
            tone="light"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await consultantService.cancelInvoice(invoice.id); await onChanged(); }
              finally { setBusy(false); }
            }}
          >
            <X className="size-3.5" /> {t('cancel')}
          </GhostButton>
        )}
        {cancelled && <span className="self-center text-xs text-muted-foreground">{t('cancelled')}</span>}
      </div>
    </div>
  );
}

/* ═══════════════════ Create ═══════════════════ */

interface DraftLine { designation: string; quantity: string; unitPriceHt: string }

function CreateSheet({
  nextSeq, defaultVatRate, canTransfer, onClose, onIssued,
}: {
  nextSeq: Record<ConsultantInvoiceKind, number> | null;
  defaultVatRate: number;
  canTransfer: boolean;
  onClose: () => void;
  onIssued: () => void | Promise<void>;
}) {
  const t = useTranslations('consultantPortal.invoices');
  const [kind, setKind] = useState<ConsultantInvoiceKind>('FACTURE');
  const [client, setClient] = useState<ConsultantClient | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([{ designation: '', quantity: '1', unitPriceHt: '' }]);
  const [vatRate, setVatRate] = useState(String(defaultVatRate));
  const [paymentMethod, setPaymentMethod] = useState<'ESPECE' | 'CHEQUE' | 'VIREMENT'>('ESPECE');
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same engine the server stores its totals with — never a second sum.
  const totals = useMemo(() => {
    const parsed = lines
      .map((l) => ({
        designation: l.designation.trim(),
        quantity: Number(l.quantity) || 0,
        unitPriceHt: Number(l.unitPriceHt) || 0,
      }))
      .filter((l) => l.designation && l.quantity > 0);
    return computeInvoiceTotals(parsed, Number(vatRate) || 0, paymentMethod, kind);
  }, [lines, vatRate, paymentMethod, kind]);

  const ready = client !== null && lines.some((l) => l.designation.trim() && Number(l.unitPriceHt) > 0);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await consultantService.issueInvoice({
        clientId: client!.id,
        kind,
        lines: lines
          .filter((l) => l.designation.trim())
          .map((l) => ({
            designation: l.designation.trim(),
            quantity: Number(l.quantity) || 1,
            unitPriceHt: Number(l.unitPriceHt) || 0,
          })),
        vatRate: Number(vatRate) || 0,
        paymentMethod,
        validUntil: kind === 'DEVIS' ? validUntil : null,
        note: note.trim() || null,
      });
      await onIssued();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('issueFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FlowSheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={t('newDocument')}
      footer={
        <BrandButton tone="light" className="w-full" disabled={!ready} loading={saving} onClick={submit}>
          {t(`issue${kind}` as 'issueFACTURE')}
        </BrandButton>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <ErrorBanner tone="light" message={error} />}

        <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted p-1">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={cn(
                'rounded px-2 py-2 text-sm transition-colors',
                kind === k ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {t(`kind${k}` as 'kindFACTURE')}
            </button>
          ))}
        </div>

        {nextSeq && (
          <p className="text-xs text-muted-foreground">
            {t('willBeNumbered', { number: String(nextSeq[kind]).padStart(2, '0') })}
          </p>
        )}

        <ClientPicker value={client} onChange={setClient} />

        <div className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <Field label={t('designation')}>
                <input
                  className={cpInputClassLight}
                  value={line.designation}
                  onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, designation: e.target.value } : l)))}
                  placeholder={t('designationPlaceholder')}
                />
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={t('quantity')}>
                  <input
                    className={cpInputClassLight}
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))}
                  />
                </Field>
                <Field label={t('unitPrice')}>
                  <input
                    className={cpInputClassLight}
                    inputMode="decimal"
                    value={line.unitPriceHt}
                    onChange={(e) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, unitPriceHt: e.target.value } : l)))}
                  />
                </Field>
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground"
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-3.5" /> {t('removeLine')}
                </button>
              )}
            </div>
          ))}
          <GhostButton
            tone="light"
            onClick={() => setLines((ls) => [...ls, { designation: '', quantity: '1', unitPriceHt: '' }])}
          >
            <Plus className="size-3.5" /> {t('addLine')}
          </GhostButton>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t('vatRate')}>
            <input
              className={cpInputClassLight}
              inputMode="decimal"
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
            />
          </Field>
          <Field label={t('paymentMethod')}>
            <select
              className={cpInputClassLight}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as 'ESPECE')}
            >
              <option value="ESPECE">{t('payEspece')}</option>
              <option value="CHEQUE">{t('payCheque')}</option>
              {/* A transfer invoice has to say where to pay. */}
              <option value="VIREMENT" disabled={!canTransfer}>
                {canTransfer ? t('payVirement') : t('payVirementNoRib')}
              </option>
            </select>
          </Field>
        </div>

        {kind === 'DEVIS' && (
          <Field label={t('validUntil')} hint={t('validUntilHint')}>
            <input
              type="date"
              className={cpInputClassLight}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </Field>
        )}

        <Field label={t('note')}>
          <textarea
            className={cn(cpInputClassLight, 'h-20 py-2')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('notePlaceholder')}
          />
        </Field>

        <div className="rounded-md bg-muted p-3">
          <Total label={t('totalHt')} value={formatDZD(totals.ht)} />
          {Number(vatRate) > 0 && <Total label={`${t('vat')} ${vatRate} %`} value={formatDZD(totals.tva)} />}
          <Total label={t('totalTtc')} value={formatDZD(totals.ttc)} />
          {totals.timbre > 0 && <Total label={t('timbre')} value={formatDZD(totals.timbre)} />}
          <div className="mt-1 border-t border-border pt-1">
            <Total label={t('netToPay')} value={formatDZD(totals.net)} emphasis />
          </div>
        </div>
      </div>
    </FlowSheet>
  );
}

function Total({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={cn('flex justify-between text-sm tabular-nums', emphasis ? 'font-bold text-destructive' : 'text-muted-foreground')}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

/* ═══════════════════ Client picker ═══════════════════ */

function ClientPicker({ value, onChange }: { value: ConsultantClient | null; onChange: (c: ConsultantClient | null) => void }) {
  const t = useTranslations('consultantPortal.invoices');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ConsultantClient[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await consultantService.searchInvoiceClients(q);
        if (!cancelled) setResults(res.items);
      } catch { /* a failed search just shows nothing */ }
    }, 220);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q]);

  if (value) {
    return (
      <Field label={t('client')}>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.legalName || value.fullName}</p>
            {value.nif && <p className="truncate text-xs text-muted-foreground">NIF {value.nif}</p>}
          </div>
          <GhostButton tone="light" onClick={() => onChange(null)}>{t('change')}</GhostButton>
        </div>
      </Field>
    );
  }

  return (
    <Field label={t('client')}>
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          className={cn(cpInputClassLight, 'ps-9')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchClient')}
        />
      </div>
      {results.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onChange(c); setQ(''); setResults([]); }}
              className="rounded-md border border-border bg-card p-2.5 text-start text-sm"
            >
              <span className="block truncate font-medium">{c.legalName || c.fullName}</span>
              {c.email && <span className="block truncate text-xs text-muted-foreground">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
      <GhostButton tone="light" className="mt-1.5" onClick={() => setAdding(true)}>
        <Plus className="size-3.5" /> {t('newClient')}
      </GhostButton>
      {adding && (
        <ClientSheet
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); onChange(c); }}
        />
      )}
    </Field>
  );
}

/* ═══════════════════ Clients ═══════════════════ */

function ClientsView() {
  const t = useTranslations('consultantPortal.invoices');
  const [items, setItems] = useState<ConsultantClient[] | null>(null);
  const [editing, setEditing] = useState<ConsultantClient | 'new' | null>(null);

  const load = useCallback(async () => {
    try { setItems((await consultantService.invoiceClients()).items); }
    catch { setItems([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-3">
      <BrandButton tone="light" className="w-full" onClick={() => setEditing('new')}>
        <Plus className="size-4" /> {t('newClient')}
      </BrandButton>

      {items === null ? (
        <SectionCard><div className="flex justify-center py-6"><Spinner tone="light" /></div></SectionCard>
      ) : items.length === 0 ? (
        <SectionCard><EmptyBlock>{t('noClients')}</EmptyBlock></SectionCard>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setEditing(c)}
              className="rounded-lg border border-border bg-card p-3 text-start"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.legalName || c.fullName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[c.rc && `RC ${c.rc}`, c.nif && `NIF ${c.nif}`, c.email].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {c.clientType === 'COMPANY' ? t('company') : t('individual')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <ClientSheet
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

function ClientSheet({
  initial, onClose, onSaved,
}: {
  initial?: ConsultantClient;
  onClose: () => void;
  onSaved: (c: ConsultantClient) => void | Promise<void>;
}) {
  const t = useTranslations('consultantPortal.invoices');
  const [clientType, setClientType] = useState<'COMPANY' | 'INDIVIDUAL'>(initial?.clientType ?? 'INDIVIDUAL');
  const [fullName, setFullName] = useState(initial?.fullName ?? '');
  const [legalName, setLegalName] = useState(initial?.legalName ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');
  const [rc, setRc] = useState(initial?.rc ?? '');
  const [nif, setNif] = useState(initial?.nif ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const company = clientType === 'COMPANY';
  const ready = fullName.trim().length >= 2 && (!company || legalName.trim().length > 0);

  async function submit() {
    setSaving(true);
    setError(null);
    const body = {
      fullName: fullName.trim(),
      clientType,
      legalName: company ? legalName.trim() : null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      rc: rc.trim() || null,
      nif: nif.trim() || null,
    };
    try {
      const saved = initial
        ? await consultantService.updateInvoiceClient(initial.id, body)
        : await consultantService.createInvoiceClient(body);
      await onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <FlowSheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={initial ? t('editClient') : t('newClient')}
      footer={
        <BrandButton tone="light" className="w-full" disabled={!ready} loading={saving} onClick={submit}>
          {t('save')}
        </BrandButton>
      }
    >
      <div className="flex flex-col gap-3">
        {error && <ErrorBanner tone="light" message={error} />}
        <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1">
          {(['INDIVIDUAL', 'COMPANY'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setClientType(k)}
              className={cn(
                'rounded px-2 py-2 text-sm transition-colors',
                clientType === k ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
              )}
            >
              {k === 'COMPANY' ? t('company') : t('individual')}
            </button>
          ))}
        </div>

        <Field label={company ? t('contactName') : t('name')}>
          <input className={cpInputClassLight} value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>
        {company && (
          <Field label={t('legalName')}>
            <input className={cpInputClassLight} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </Field>
        )}
        <Field label={t('email')}>
          <input className={cpInputClassLight} inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label={t('phone')}>
          <input className={cpInputClassLight} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label={t('address')}>
          <input className={cpInputClassLight} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        {company && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="RC"><input className={cpInputClassLight} value={rc} onChange={(e) => setRc(e.target.value)} /></Field>
            <Field label="NIF"><input className={cpInputClassLight} value={nif} onChange={(e) => setNif(e.target.value)} /></Field>
          </div>
        )}
      </div>
    </FlowSheet>
  );
}

/* ═══════════════════ Legal settings ═══════════════════ */

function SettingsView({ settings, onSaved }: { settings: ConsultantInvoiceSettingsDto; onSaved: () => void | Promise<void> }) {
  const t = useTranslations('consultantPortal.invoices');
  const { issuer } = settings;
  const [status, setStatus] = useState<'AUTO_ENTREPRENEUR' | 'REGISTRE_COMMERCE'>(
    issuer.regLabel === 'Carte AE' ? 'AUTO_ENTREPRENEUR' : 'REGISTRE_COMMERCE',
  );
  const [rcType, setRcType] = useState<'PERSONNE_PHYSIQUE' | 'PERSONNE_MORALE' | null>(
    issuer.rcType ?? null,
  );
  const [reg, setReg] = useState(issuer.reg ?? '');
  const [nif, setNif] = useState(issuer.nif ?? '');
  const [nis, setNis] = useState(issuer.nis ?? '');
  const [ai, setAi] = useState(issuer.ai ?? '');
  const [address, setAddress] = useState(issuer.address ?? '');
  const [bankName, setBankName] = useState(issuer.bankName ?? '');
  const [bankRib, setBankRib] = useState(issuer.bankRib ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Under the IFU — an auto-entrepreneur, or a personne physique on an RC. */
  const noVat = status === 'AUTO_ENTREPRENEUR' || rcType === 'PERSONNE_PHYSIQUE';

  /* Letterhead + stamp. Their OWN fields: the consultant's photo is not a
     letterhead, and there is no fallback to Metwork's mark — printing it would
     put the platform's identity on a document between them and their client. */
  const logoInput = useRef<HTMLInputElement>(null);
  const stampInput = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState(issuer.logoUrl ?? '');
  const [stampUrl, setStampUrl] = useState(issuer.stampUrl ?? '');
  const [uploading, setUploading] = useState<'invoice-logo' | 'invoice-stamp' | null>(null);

  async function upload(kind: 'invoice-logo' | 'invoice-stamp', file: File | undefined) {
    if (!file) return;
    setUploading(kind);
    setError(null);
    try {
      const url = await uploadConsultantFile(file, kind);
      if (kind === 'invoice-logo') setLogoUrl(url); else setStampUrl(url);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setUploading(null);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await consultantService.saveInvoiceSettings({
        invoiceLegalStatus: status,
        // Only meaningful under an RC; cleared otherwise so a consultant who
        // moves to auto-entrepreneur does not keep a stale regime.
        invoiceRcType: status === 'REGISTRE_COMMERCE' ? rcType : null,
        invoiceRegNumber: reg,
        nif, nis, ai, address, bankName, bankRib,
      });
      setSaved(true);
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{t('settingsIntro')}</p>
        {error && <ErrorBanner tone="light" message={error} />}

        <Field label={t('legalStatus')}>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1">
            {(['AUTO_ENTREPRENEUR', 'REGISTRE_COMMERCE'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatus(k)}
                className={cn(
                  'rounded px-2 py-2 text-sm transition-colors',
                  status === k ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
                )}
              >
                {k === 'AUTO_ENTREPRENEUR' ? t('statusAutoEntrepreneur') : t('statusRegistreCommerce')}
              </button>
            ))}
          </div>
        </Field>

        {status === 'REGISTRE_COMMERCE' && (
          <Field label={t('rcType')} hint={t('rcTypeHint')}>
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted p-1">
              {(['PERSONNE_PHYSIQUE', 'PERSONNE_MORALE'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setRcType(k)}
                  className={cn(
                    'rounded px-2 py-2 text-sm transition-colors',
                    rcType === k ? 'bg-primary font-semibold text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {k === 'PERSONNE_PHYSIQUE' ? t('personnePhysique') : t('personneMorale')}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field
          label={status === 'AUTO_ENTREPRENEUR' ? t('cardNumber') : t('rcNumber')}
          hint={noVat ? t('vatHintIfu') : status === 'REGISTRE_COMMERCE' && rcType ? t('vatHintReel') : undefined}
        >
          <input className={cpInputClassLight} value={reg} onChange={(e) => setReg(e.target.value)} />
        </Field>
        <Field label="NIF"><input className={cpInputClassLight} value={nif} onChange={(e) => setNif(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="NIS"><input className={cpInputClassLight} value={nis} onChange={(e) => setNis(e.target.value)} /></Field>
          <Field
            label={status === 'REGISTRE_COMMERCE' ? t('taxArticleRequired') : t('taxArticle')}
          >
            <input className={cpInputClassLight} value={ai} onChange={(e) => setAi(e.target.value)} />
          </Field>
        </div>
        <Field label={t('address')} hint={t('addressHint')}>
          <input className={cpInputClassLight} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('bankName')}><input className={cpInputClassLight} value={bankName} onChange={(e) => setBankName(e.target.value)} /></Field>
          <Field label="RIB"><input className={cpInputClassLight} inputMode="numeric" value={bankRib} onChange={(e) => setBankRib(e.target.value)} /></Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label={t('logo')} hint={t('logoHint')}>
            <input
              ref={logoInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => void upload('invoice-logo', e.target.files?.[0])}
            />
            <GhostButton tone="light" disabled={uploading !== null} onClick={() => logoInput.current?.click()}>
              {logoUrl ? t('replace') : t('upload')}
            </GhostButton>
          </Field>
          <Field label={t('stamp')} hint={t('stampHint')}>
            <input
              ref={stampInput} type="file" accept="image/*" className="hidden"
              onChange={(e) => void upload('invoice-stamp', e.target.files?.[0])}
            />
            <GhostButton tone="light" disabled={uploading !== null} onClick={() => stampInput.current?.click()}>
              {stampUrl ? t('replace') : t('upload')}
            </GhostButton>
          </Field>
        </div>

        <BrandButton tone="light" className="w-full" loading={saving} onClick={submit}>
          {saved ? t('savedOk') : t('save')}
        </BrandButton>
      </div>
    </SectionCard>
  );
}
