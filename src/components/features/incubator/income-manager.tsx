'use client';

import { useEffect, useState } from 'react';
import { ArrowUpCircle, Banknote, CreditCard, Loader2, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ListingManagementTable, type ListingColumn } from './listing-management-table';
import { CsvImportDialog } from './csv-import-dialog';
import { ClientSelector } from './client-selector';
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { IncomePaymentMethod } from '@/server/db/store';

interface IncomeRow {
  id: string;
  clientId: string | null;
  clientName: string;
  serviceName: string;
  date: string;
  amount: number;
  paymentMethod: IncomePaymentMethod;
  notes: string | null;
  importBatchId: string | null;
  createdAt: string;
}

interface ClientHit {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string | null;
}

interface ServiceOption {
  id: string;
  name: string;
  isActive: boolean;
}

const CSV_FIELDS = [
  { header: 'Date',           field: 'date' },
  { header: 'Client',         field: 'clientName' },
  { header: 'Service',        field: 'serviceName' },
  { header: 'Amount',         field: 'amount',  numeric: true },
  { header: 'PaymentMethod',  field: 'paymentMethod' },
];

const PAYMENT_METHODS: { value: IncomePaymentMethod; label: string }[] = [
  { value: 'CASH',   label: 'Cash' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'OTHER',  label: 'Other' },
];

function paymentIcon(m: IncomePaymentMethod) {
  if (m === 'CASH')   return <Banknote className="size-3.5 text-muted-foreground" />;
  if (m === 'ONLINE') return <CreditCard className="size-3.5 text-muted-foreground" />;
  return null;
}

/* ── Service selector — dropdown when services exist, free text fallback ── */
function ServiceField({
  id,
  value,
  otherValue,
  services,
  onChange,
  onOtherChange,
}: {
  id: string;
  value: string;
  otherValue: string;
  services: ServiceOption[];
  onChange: (v: string) => void;
  onOtherChange: (v: string) => void;
}) {
  if (services.length === 0) {
    return (
      <Input id={id} className="mt-1" value={value}
        onChange={(e) => onChange(e.target.value)} required minLength={1} maxLength={120}
        placeholder="e.g. Coworking, Private Office…" />
    );
  }
  return (
    <>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="mt-1">
          <SelectValue placeholder="Select a service…" />
        </SelectTrigger>
        <SelectContent>
          {services.map((s) => (
            <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>
          ))}
          <SelectItem value="__other__">Other…</SelectItem>
        </SelectContent>
      </Select>
      {value === '__other__' && (
        <Input
          className="mt-1.5"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Enter service name"
          required
          maxLength={120}
        />
      )}
    </>
  );
}

/* ── Create dialog ── */
function CreateIncomeDialog({
  onCreated,
  services,
}: {
  onCreated: () => void;
  services: ServiceOption[];
}) {
  const t = useTranslations('incubator.income');
  const [open, setOpen]           = useState(false);
  const [sub, setSub]             = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [client, setClient]       = useState<ClientHit | null>(null);
  const [clientName, setClientName] = useState('');
  const [svcSelect, setSvcSelect] = useState('');
  const [svcOther, setSvcOther]   = useState('');
  const [amount, setAmt]          = useState('');
  const [method, setMethod]       = useState<IncomePaymentMethod>('CASH');
  const [notes, setNotes]         = useState('');

  function reset() {
    setDate(new Date().toISOString().slice(0, 10));
    setClient(null); setClientName(''); setSvcSelect(''); setSvcOther('');
    setAmt(''); setMethod('CASH'); setNotes(''); setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const name = client?.fullName ?? clientName.trim();
    if (!name) { setError('Client name is required.'); return; }
    const serviceName = svcSelect === '__other__' ? svcOther.trim() : svcSelect.trim();
    if (!serviceName) { setError('Service is required.'); return; }
    setSub(true);
    try {
      const res = await fetch('/api/incubator/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          clientId:      client?.id ?? null,
          clientName:    name,
          serviceName,
          amount:        Number(amount),
          paymentMethod: method,
          notes:         notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        setError(d.message ?? 'Failed to add income record.'); return;
      }
      onCreated(); setOpen(false); reset();
    } catch { setError('Network error.'); }
    finally { setSub(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusCircle className="size-4" />
          {t('addIncome')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inc-date">{t('labelDate')}</Label>
              <Input id="inc-date" type="date" className="mt-1" value={date}
                onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="inc-amount">{t('labelAmount')}</Label>
              <Input id="inc-amount" type="number" min="0" className="mt-1" value={amount}
                onChange={(e) => setAmt(e.target.value)} required placeholder="0" />
            </div>
          </div>

          <div>
            <Label htmlFor="inc-client">{t('labelClient')}</Label>
            <ClientSelector
              id="inc-client"
              value={client}
              onSelect={(c) => { setClient(c); setClientName(c?.fullName ?? ''); }}
              placeholder="Search or type client name…"
            />
            {!client && (
              <Input
                className="mt-1.5"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Or type a new client name"
                maxLength={120}
              />
            )}
          </div>

          <div>
            <Label htmlFor="inc-svc">{t('labelService')}</Label>
            <ServiceField
              id="inc-svc"
              value={svcSelect}
              otherValue={svcOther}
              services={services}
              onChange={setSvcSelect}
              onOtherChange={setSvcOther}
            />
          </div>

          <div>
            <Label htmlFor="inc-method">{t('labelPaymentMethod')}</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as IncomePaymentMethod)}>
              <SelectTrigger id="inc-method" className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="inc-notes">{t('labelNotes')}</Label>
            <textarea
              id="inc-notes"
              className="mt-1 min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" loading={sub}>{t('addIncome')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncomeManager() {
  const locale                      = useLocale() as Locale;
  const t                           = useTranslations('incubator.income');
  const [rows, setRows]             = useState<IncomeRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [services, setServices]     = useState<ServiceOption[]>([]);

  // Edit state
  const [editOpen, setEditOpen]       = useState(false);
  const [editing, setEditing]         = useState<IncomeRow | null>(null);
  const [editDate, setEditDate]       = useState('');
  const [editClient, setEditClient]   = useState('');
  const [editSvcSelect, setEditSvcSel] = useState('');
  const [editSvcOther, setEditSvcOther] = useState('');
  const [editAmt, setEditAmt]         = useState('');
  const [editMethod, setEditMethod]   = useState<IncomePaymentMethod>('CASH');
  const [editNotes, setEditNotes]     = useState('');
  const [editError, setEditError]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);

  async function fetchIncome() {
    setLoading(true); setFetchError(null);
    try {
      const res = await fetch('/api/incubator/income', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load income');
      const data = await res.json() as { items: IncomeRow[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading income');
    } finally { setLoading(false); }
  }

  async function fetchServices() {
    try {
      const res = await fetch('/api/incubator/services', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { items: ServiceOption[] };
      setServices(data.items.filter((s) => s.isActive));
    } catch { /* services dropdown degrades to text input */ }
  }

  useEffect(() => {
    void fetchIncome();
    void fetchServices();
  }, []);

  function openEdit(row: IncomeRow) {
    setEditing(row);
    setEditDate(row.date);
    setEditClient(row.clientName);
    // If row's service matches a known service, pre-select it; otherwise use "other"
    const knownSvc = services.find((s) => s.name === row.serviceName);
    if (knownSvc) {
      setEditSvcSel(row.serviceName);
      setEditSvcOther('');
    } else if (services.length > 0) {
      setEditSvcSel('__other__');
      setEditSvcOther(row.serviceName);
    } else {
      setEditSvcSel(row.serviceName);
      setEditSvcOther('');
    }
    setEditAmt(String(row.amount));
    setEditMethod(row.paymentMethod);
    setEditNotes(row.notes ?? '');
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const serviceName = editSvcSelect === '__other__' ? editSvcOther.trim() : editSvcSelect.trim();
    if (!serviceName) { setEditError('Service is required.'); return; }
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/incubator/income/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:          editDate,
          clientName:    editClient.trim(),
          serviceName,
          amount:        Number(editAmt),
          paymentMethod: editMethod,
          notes:         editNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        setEditError(d.message ?? 'Failed to save.'); return;
      }
      setEditOpen(false); void fetchIncome();
    } catch { setEditError('Network error.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(row: IncomeRow) {
    if (!confirm(`Delete income record from ${row.date}?`)) return;
    const res = await fetch(`/api/incubator/income/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      alert(body.message ?? 'Failed to delete income record. Please try again.');
    }
    void fetchIncome();
  }

  const columns: ListingColumn<IncomeRow>[] = [
    {
      key: 'date',
      label: t('colDate'),
      render: (r) => <span className="text-sm">{r.date}</span>,
    },
    {
      key: 'client',
      label: t('colClient'),
      render: (r) => (
        <div>
          <div className="font-medium">{r.clientName}</div>
          {r.importBatchId && (
            <div className="text-xs text-muted-foreground">Imported</div>
          )}
        </div>
      ),
    },
    {
      key: 'service',
      label: t('colService'),
      render: (r) => <Badge variant="outline">{r.serviceName}</Badge>,
    },
    {
      key: 'method',
      label: t('colPayment'),
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {paymentIcon(r.paymentMethod)}
          {r.paymentMethod}
        </span>
      ),
    },
    {
      key: 'amount',
      label: t('colAmount'),
      align: 'end',
      render: (r) => (
        <span className="font-medium text-green-600 dark:text-green-400">
          +{formatCurrency(r.amount, locale)}
        </span>
      ),
    },
  ];

  const headerSlot = (
    <div className="flex items-center gap-2">
      <CsvImportDialog
        endpoint="/api/incubator/income/import"
        fields={CSV_FIELDS}
        description="Columns: Date (YYYY-MM-DD), Client, Service, Amount, PaymentMethod (CASH/ONLINE/OTHER)"
        onImported={() => void fetchIncome()}
      />
      <CreateIncomeDialog onCreated={() => void fetchIncome()} services={services} />
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading…
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
    <>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('editTitle')}</DialogTitle>
            <DialogDescription>{t('editDescription')}</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="einc-date">{t('labelDate')}</Label>
                <Input id="einc-date" type="date" className="mt-1" value={editDate}
                  onChange={(e) => setEditDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="einc-amt">{t('labelAmount')}</Label>
                <Input id="einc-amt" type="number" min="0" className="mt-1" value={editAmt}
                  onChange={(e) => setEditAmt(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="einc-client">{t('labelClientName')}</Label>
              <Input id="einc-client" className="mt-1" value={editClient}
                onChange={(e) => setEditClient(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="einc-svc">{t('labelService')}</Label>
              <ServiceField
                id="einc-svc"
                value={editSvcSelect}
                otherValue={editSvcOther}
                services={services}
                onChange={setEditSvcSel}
                onOtherChange={setEditSvcOther}
              />
            </div>
            <div>
              <Label htmlFor="einc-method">{t('labelPaymentMethod')}</Label>
              <Select value={editMethod} onValueChange={(v) => setEditMethod(v as IncomePaymentMethod)}>
                <SelectTrigger id="einc-method" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="einc-notes">{t('labelNotes')}</Label>
              <textarea
                id="einc-notes"
                className="mt-1 min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editNotes} onChange={(e) => setEditNotes(e.target.value)} maxLength={1000}
              />
            </div>
            {editError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {editError}
              </div>
            )}
            <DialogFooter>
              <Button type="submit" loading={saving}>{t('saveChanges')}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ListingManagementTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        createSlot={headerSlot}
        emptyIcon={<ArrowUpCircle className="size-5 text-muted-foreground" />}
        emptyTitle={t('emptyTitle')}
        emptyDescription={t('emptyDescription')}
        actions={[
          { label: t('actionEdit'), icon: <Pencil className="size-4" />, onSelect: openEdit },
          { label: t('actionDelete'), icon: <Trash2 className="size-4" />, onSelect: (row) => void handleDelete(row), destructive: true },
        ]}
      />
    </>
  );
}
