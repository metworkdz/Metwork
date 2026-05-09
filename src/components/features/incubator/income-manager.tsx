'use client';

import { useEffect, useState } from 'react';
import { ArrowUpCircle, Banknote, CreditCard, Loader2, Pencil, PlusCircle, Trash2 } from 'lucide-react';
import { useLocale } from 'next-intl';
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

/* ── Create dialog ── */
function CreateIncomeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen]           = useState(false);
  const [sub, setSub]             = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [client, setClient]       = useState<ClientHit | null>(null);
  const [clientName, setClientName] = useState('');
  const [serviceName, setSvc]     = useState('');
  const [amount, setAmt]          = useState('');
  const [method, setMethod]       = useState<IncomePaymentMethod>('CASH');
  const [notes, setNotes]         = useState('');

  function reset() {
    setDate(new Date().toISOString().slice(0, 10));
    setClient(null); setClientName(''); setSvc(''); setAmt('');
    setMethod('CASH'); setNotes(''); setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    const name = client?.fullName ?? clientName.trim();
    if (!name) { setError('Client name is required.'); return; }
    setSub(true);
    try {
      const res = await fetch('/api/incubator/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          clientId:      client?.id ?? null,
          clientName:    name,
          serviceName:   serviceName.trim(),
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
          Add income
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New income record</DialogTitle>
          <DialogDescription>Record a manual income entry.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="inc-date">Date *</Label>
              <Input id="inc-date" type="date" className="mt-1" value={date}
                onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="inc-amount">Amount (DZD) *</Label>
              <Input id="inc-amount" type="number" min="0" className="mt-1" value={amount}
                onChange={(e) => setAmt(e.target.value)} required placeholder="0" />
            </div>
          </div>

          <div>
            <Label htmlFor="inc-client">Client *</Label>
            <ClientSelector
              id="inc-client"
              value={client}
              onSelect={(c) => { setClient(c); setClientName(c?.fullName ?? ''); }}
              placeholder="Search or type client name…"
            />
            {/* Free-text fallback when no suggestion is selected */}
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
            <Label htmlFor="inc-svc">Service *</Label>
            <Input id="inc-svc" className="mt-1" value={serviceName}
              onChange={(e) => setSvc(e.target.value)} required minLength={1} maxLength={120}
              placeholder="e.g. Coworking, Private Office…" />
          </div>

          <div>
            <Label htmlFor="inc-method">Payment method</Label>
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
            <Label htmlFor="inc-notes">Notes</Label>
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
            <Button type="submit" loading={sub}>Add income</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncomeManager() {
  const locale                      = useLocale() as Locale;
  const [rows, setRows]             = useState<IncomeRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen]   = useState(false);
  const [editing, setEditing]     = useState<IncomeRow | null>(null);
  const [editDate, setEditDate]   = useState('');
  const [editClient, setEditClient] = useState('');
  const [editSvc, setEditSvc]     = useState('');
  const [editAmt, setEditAmt]     = useState('');
  const [editMethod, setEditMethod] = useState<IncomePaymentMethod>('CASH');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

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

  useEffect(() => { void fetchIncome(); }, []);

  function openEdit(row: IncomeRow) {
    setEditing(row);
    setEditDate(row.date);
    setEditClient(row.clientName);
    setEditSvc(row.serviceName);
    setEditAmt(String(row.amount));
    setEditMethod(row.paymentMethod);
    setEditNotes(row.notes ?? '');
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/incubator/income/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:          editDate,
          clientName:    editClient.trim(),
          serviceName:   editSvc.trim(),
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
    await fetch(`/api/incubator/income/${row.id}`, { method: 'DELETE' });
    void fetchIncome();
  }

  const columns: ListingColumn<IncomeRow>[] = [
    {
      key: 'date',
      label: 'Date',
      render: (r) => <span className="text-sm">{r.date}</span>,
    },
    {
      key: 'client',
      label: 'Client',
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
      label: 'Service',
      render: (r) => <Badge variant="outline">{r.serviceName}</Badge>,
    },
    {
      key: 'method',
      label: 'Payment',
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {paymentIcon(r.paymentMethod)}
          {r.paymentMethod}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
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
      <CreateIncomeDialog onCreated={() => void fetchIncome()} />
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
            <DialogTitle>Edit income record</DialogTitle>
            <DialogDescription>Update the income details.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-3 py-2">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="einc-date">Date *</Label>
                <Input id="einc-date" type="date" className="mt-1" value={editDate}
                  onChange={(e) => setEditDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="einc-amt">Amount (DZD) *</Label>
                <Input id="einc-amt" type="number" min="0" className="mt-1" value={editAmt}
                  onChange={(e) => setEditAmt(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="einc-client">Client name *</Label>
              <Input id="einc-client" className="mt-1" value={editClient}
                onChange={(e) => setEditClient(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="einc-svc">Service *</Label>
              <Input id="einc-svc" className="mt-1" value={editSvc}
                onChange={(e) => setEditSvc(e.target.value)} required maxLength={120} />
            </div>
            <div>
              <Label htmlFor="einc-method">Payment method</Label>
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
              <Label htmlFor="einc-notes">Notes</Label>
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
              <Button type="submit" loading={saving}>Save changes</Button>
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
        emptyTitle="No income records yet"
        emptyDescription="Add income manually or import from CSV."
        actions={[
          { label: 'Edit', icon: <Pencil className="size-4" />, onSelect: openEdit },
          { label: 'Delete', icon: <Trash2 className="size-4" />, onSelect: (row) => void handleDelete(row), destructive: true },
        ]}
      />
    </>
  );
}
