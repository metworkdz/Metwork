'use client';

/**
 * Investment tracker. Displays the investor's logged deals and lets them
 * add, edit, and delete entries.
 */
import { useState } from 'react';
import { Plus, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { InlineEmptyState } from '@/components/shared/inline-empty-state';
import { formatCurrency } from '@/lib/format';
import type { InvestmentRecord, InvestmentStatus } from '@/server/db/store';
import type { Locale } from '@/i18n/config';

const STATUS_LABELS: Record<InvestmentStatus, string> = {
  PROSPECTING:   'Prospecting',
  TERM_SHEET:    'Term sheet',
  DUE_DILIGENCE: 'Due diligence',
  CLOSED:        'Closed',
  PASSED:        'Passed',
};

const STATUS_VARIANT: Record<InvestmentStatus, 'default' | 'info' | 'warning' | 'success' | 'danger'> = {
  PROSPECTING:   'default',
  TERM_SHEET:    'info',
  DUE_DILIGENCE: 'warning',
  CLOSED:        'success',
  PASSED:        'danger',
};

interface DealFormState {
  startupName: string;
  amount:      string;
  equity:      string;
  status:      InvestmentStatus;
  notes:       string;
}

const EMPTY_FORM: DealFormState = {
  startupName: '',
  amount:      '',
  equity:      '',
  status:      'PROSPECTING',
  notes:       '',
};

interface Props {
  initial: InvestmentRecord[];
  locale:  Locale;
}

export function InvestmentTracker({ initial, locale }: Props) {
  const [deals,    setDeals]    = useState<InvestmentRecord[]>(initial);
  const [editing,  setEditing]  = useState<InvestmentRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form,     setForm]     = useState<DealFormState>(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [deleting, setDeleting] = useState<InvestmentRecord | null>(null);
  const [delBusy,  setDelBusy]  = useState(false);

  function setField<K extends keyof DealFormState>(k: K, v: DealFormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(deal: InvestmentRecord) {
    setEditing(deal);
    setForm({
      startupName: deal.startupName,
      amount:      String(deal.amount),
      equity:      String(deal.equity),
      status:      deal.status,
      notes:       deal.notes,
    });
    setError(null);
    setFormOpen(true);
  }

  async function save() {
    const amount = parseInt(form.amount, 10);
    const equity = parseFloat(form.equity);
    if (!form.startupName.trim()) { setError('Startup name is required.'); return; }
    if (isNaN(amount) || amount < 0) { setError('Enter a valid amount (0 or more).'); return; }
    if (isNaN(equity) || equity < 0 || equity > 100) { setError('Equity must be 0–100%.'); return; }

    setSaving(true); setError(null);
    try {
      const body = {
        startupName: form.startupName.trim(),
        amount,
        equity,
        status: form.status,
        notes:  form.notes.trim(),
      };

      if (editing) {
        const res = await fetch(`/api/investor/deals/${editing.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Update failed');
        const data = await res.json() as { deal: InvestmentRecord };
        setDeals((prev) => prev.map((d) => d.id === editing.id ? data.deal : d));
      } else {
        const res = await fetch('/api/investor/deals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('Create failed');
        const data = await res.json() as { deal: InvestmentRecord };
        setDeals((prev) => [data.deal, ...prev]);
      }

      setFormOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDelBusy(true);
    try {
      const res = await fetch(`/api/investor/deals/${deleting.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Delete failed');
      setDeals((prev) => prev.filter((d) => d.id !== deleting.id));
      setDeleting(null);
    } finally {
      setDelBusy(false);
    }
  }

  // Summary stats
  const totalCommitted = deals
    .filter((d) => d.status === 'CLOSED')
    .reduce((s, d) => s + d.amount, 0);
  const activeDeals = deals.filter(
    (d) => d.status !== 'CLOSED' && d.status !== 'PASSED',
  ).length;

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total deals" value={String(deals.length)}     accent="muted" />
        <SummaryCard label="Active"       value={String(activeDeals)}      accent="primary" />
        <SummaryCard
          label="Committed (closed)"
          value={formatCurrency(totalCommitted, locale)}
          accent="muted"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">
          {deals.length} deal{deals.length !== 1 ? 's' : ''} tracked
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4" /> Add deal
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {deals.length === 0 ? (
            <InlineEmptyState
              title="No deals tracked yet"
              description="Log your first investment or prospect."
              icon={<TrendingUp className="size-5 text-muted-foreground" />}
              action={<Button size="sm" onClick={openCreate}><Plus className="size-4" /> Add deal</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Startup</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-end">Amount</TableHead>
                    <TableHead className="text-end">Equity</TableHead>
                    <TableHead className="hidden md:table-cell">Notes</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.startupName}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[d.status]}>
                          {STATUS_LABELS[d.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-end tabular-nums">
                        {d.amount > 0 ? formatCurrency(d.amount, locale) : '—'}
                      </TableCell>
                      <TableCell className="text-end">{d.equity > 0 ? `${d.equity}%` : '—'}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-[24ch] truncate text-sm text-muted-foreground">
                        {d.notes || '—'}
                      </TableCell>
                      <TableCell className="text-end">
                        <div className="inline-flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(d)}
                            aria-label="Edit"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleting(d)}
                            aria-label="Delete"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
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

      {/* Add / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) setFormOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit deal' : 'Add deal'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update this tracked investment.' : 'Log a new deal or prospect.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="deal-name">Startup name *</Label>
              <Input
                id="deal-name"
                value={form.startupName}
                onChange={(e) => setField('startupName', e.target.value)}
                placeholder="e.g. Acme Algeria"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="deal-amount">Amount committed (DZD)</Label>
                <Input
                  id="deal-amount"
                  type="number"
                  min={0}
                  step={1}
                  inputMode="numeric"
                  value={form.amount}
                  onChange={(e) => setField('amount', e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="deal-equity">Equity (%)</Label>
                <Input
                  id="deal-equity"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  inputMode="decimal"
                  value={form.equity}
                  onChange={(e) => setField('equity', e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setField('status', v as InvestmentStatus)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as InvestmentStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deal-notes">Notes</Label>
              <textarea
                id="deal-notes"
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                rows={3}
                placeholder="Meeting notes, terms, due diligence checklist…"
                className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button loading={saving} onClick={save}>
              {editing ? 'Save changes' : 'Add deal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleting !== null} onOpenChange={(o) => { if (!o) setDeleting(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove deal?</DialogTitle>
            <DialogDescription>
              {deleting && <>Remove <span className="font-medium">{deleting.startupName}</span> from your tracker?</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={delBusy}>Keep</Button>
            <Button variant="destructive" loading={delBusy} onClick={confirmDelete}>Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'primary' | 'muted';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`mt-2 text-2xl font-semibold ${accent === 'primary' ? 'text-primary-700' : ''}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
