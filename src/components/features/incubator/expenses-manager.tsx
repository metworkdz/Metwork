'use client';

import { useEffect, useState } from 'react';
import { ArrowDownCircle, Loader2, Pencil, PlusCircle, Trash2 } from 'lucide-react';
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
import { formatCurrency } from '@/lib/format';
import type { Locale } from '@/i18n/config';

interface ExpenseRow {
  id: string;
  date: string;
  title: string;
  description: string | null;
  amount: number;
  category: string | null;
  /** Set when the expense was spent on one of the incubator's programs. */
  programId?: string | null;
  createdAt: string;
}

interface ProgramOption { id: string; title: string }

const NO_PROGRAM = '__none__';

/* ── Program selector — tags the expense so it counts in that program's report ── */
function ProgramField({
  id, value, onChange, programs,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  programs: ProgramOption[];
}) {
  const t = useTranslations('incubator.expenses');
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="mt-1">
        <SelectValue placeholder={t('noProgram')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PROGRAM}>{t('noProgram')}</SelectItem>
        {programs.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
        ))}
        {/* A tag on a program deleted since stays selectable, so saving keeps it. */}
        {value !== NO_PROGRAM && !programs.some((p) => p.id === value) && (
          <SelectItem value={value}>{t('deletedProgram')}</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

const CSV_FIELDS = [
  { header: 'Date',        field: 'date' },
  { header: 'Title',       field: 'title' },
  { header: 'Description', field: 'description' },
  { header: 'Amount',      field: 'amount',  numeric: true },
  { header: 'Category',    field: 'category' },
];

const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Internet & Phone',
  'Equipment',
  'Salaries',
  'Marketing',
  'Office Supplies',
  'Maintenance',
  'Insurance',
  'Software & Tools',
  'Events',
  'Travel',
  'Taxes & Fees',
  'Other',
] as const;

const NO_CATEGORY = '__none__';
const OTHER_CATEGORY = '__other__';

/* ── Category selector — dropdown with predefined options ── */
function CategoryField({
  id,
  value,
  otherValue,
  onChange,
  onOtherChange,
}: {
  id: string;
  value: string;
  otherValue: string;
  onChange: (v: string) => void;
  onOtherChange: (v: string) => void;
}) {
  return (
    <>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="mt-1">
          <SelectValue placeholder="Select a category…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_CATEGORY}>— No category</SelectItem>
          {EXPENSE_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
          <SelectItem value={OTHER_CATEGORY}>Other…</SelectItem>
        </SelectContent>
      </Select>
      {value === OTHER_CATEGORY && (
        <Input
          className="mt-1.5"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Enter category name"
          maxLength={80}
        />
      )}
    </>
  );
}

/* ── Create dialog ── */
function CreateExpenseDialog({ onCreated, programs }: { onCreated: () => void; programs: ProgramOption[] }) {
  const t = useTranslations('incubator.expenses');
  const [open, setOpen]     = useState(false);
  const [sub, setSub]       = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [date, setDate]     = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle]   = useState('');
  const [desc, setDesc]     = useState('');
  const [amount, setAmt]    = useState('');
  const [catSel, setCatSel] = useState(NO_CATEGORY);
  const [catOther, setCatOther] = useState('');
  const [programSel, setProgramSel] = useState(NO_PROGRAM);

  function reset() {
    setTitle(''); setDesc(''); setAmt(''); setCatSel(NO_CATEGORY); setCatOther(''); setProgramSel(NO_PROGRAM);
    setDate(new Date().toISOString().slice(0, 10)); setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSub(true);
    const category = catSel === NO_CATEGORY ? null
      : catSel === OTHER_CATEGORY ? (catOther.trim() || null)
      : catSel;
    try {
      const res = await fetch('/api/incubator/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          title:       title.trim(),
          description: desc.trim() || null,
          amount:      Number(amount),
          category,
          programId:   programSel === NO_PROGRAM ? null : programSel,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string; error?: { message?: string } };
        setError(d.error?.message ?? d.message ?? 'Failed to create expense.'); return;
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
          {t('addExpense')}
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
              <Label htmlFor="exp-date">{t('labelDate')}</Label>
              <Input id="exp-date" type="date" className="mt-1" value={date}
                onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="exp-amount">{t('labelAmount')}</Label>
              <Input id="exp-amount" type="number" min="1" className="mt-1" value={amount}
                onChange={(e) => setAmt(e.target.value)} required placeholder="0" />
            </div>
          </div>
          <div>
            <Label htmlFor="exp-title">{t('labelTitle')}</Label>
            <Input id="exp-title" className="mt-1" value={title}
              onChange={(e) => setTitle(e.target.value)} required minLength={1} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="exp-cat">{t('labelCategory')}</Label>
            <CategoryField
              id="exp-cat"
              value={catSel}
              otherValue={catOther}
              onChange={setCatSel}
              onOtherChange={setCatOther}
            />
          </div>
          {programs.length > 0 && (
            <div>
              <Label htmlFor="exp-program">{t('labelProgram')}</Label>
              <ProgramField id="exp-program" value={programSel} onChange={setProgramSel} programs={programs} />
            </div>
          )}
          <div>
            <Label htmlFor="exp-desc">{t('labelDescription')}</Label>
            <textarea
              id="exp-desc"
              className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000}
            />
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
          <DialogFooter>
            <Button type="submit" loading={sub}>{t('addExpense')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesManager() {
  const locale                      = useLocale() as Locale;
  const t                           = useTranslations('incubator.expenses');
  const [rows, setRows]             = useState<ExpenseRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Edit state
  const [editOpen, setEditOpen]       = useState(false);
  const [editing, setEditing]         = useState<ExpenseRow | null>(null);
  const [editDate, setEditDate]       = useState('');
  const [editTitle, setEditTitle]     = useState('');
  const [editDesc, setEditDesc]       = useState('');
  const [editAmt, setEditAmt]         = useState('');
  const [editCatSel, setEditCatSel]   = useState(NO_CATEGORY);
  const [editCatOther, setEditCatOther] = useState('');
  const [editProgram, setEditProgram] = useState(NO_PROGRAM);
  const [programs, setPrograms]       = useState<ProgramOption[]>([]);
  const [editError, setEditError]     = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);

  async function fetchExpenses() {
    setLoading(true); setFetchError(null);
    try {
      const res = await fetch('/api/incubator/expenses', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load expenses');
      const data = await res.json() as { items: ExpenseRow[] };
      setRows(data.items);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : 'Error loading expenses');
    } finally { setLoading(false); }
  }

  useEffect(() => { void fetchExpenses(); }, []);

  // The incubator's programs, to tag an expense with one and to name the tag.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/incubator/programs', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json() as { items: ProgramOption[] };
        setPrograms(data.items.map((p) => ({ id: p.id, title: p.title })));
      } catch { /* the tag stays optional */ }
    })();
  }, []);

  function openEdit(row: ExpenseRow) {
    setEditing(row);
    setEditDate(row.date);
    setEditTitle(row.title);
    setEditDesc(row.description ?? '');
    setEditAmt(String(row.amount));
    // Map existing category value to dropdown selection
    if (!row.category) {
      setEditCatSel(NO_CATEGORY);
      setEditCatOther('');
    } else if ((EXPENSE_CATEGORIES as readonly string[]).includes(row.category)) {
      setEditCatSel(row.category);
      setEditCatOther('');
    } else {
      setEditCatSel(OTHER_CATEGORY);
      setEditCatOther(row.category);
    }
    setEditProgram(row.programId ?? NO_PROGRAM);
    setEditError(null);
    setEditOpen(true);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const category = editCatSel === NO_CATEGORY ? null
      : editCatSel === OTHER_CATEGORY ? (editCatOther.trim() || null)
      : editCatSel;
    setSaving(true); setEditError(null);
    try {
      const res = await fetch(`/api/incubator/expenses/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:        editDate,
          title:       editTitle.trim(),
          description: editDesc.trim() || null,
          amount:      Number(editAmt),
          category,
          programId:   editProgram === NO_PROGRAM ? null : editProgram,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string; error?: { message?: string } };
        setEditError(d.error?.message ?? d.message ?? 'Failed to save.'); return;
      }
      setEditOpen(false); void fetchExpenses();
    } catch { setEditError('Network error.'); }
    finally { setSaving(false); }
  }

  async function handleDelete(row: ExpenseRow) {
    if (!confirm(`Delete expense "${row.title}"?`)) return;
    const res = await fetch(`/api/incubator/expenses/${row.id}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string };
      alert(body.message ?? 'Failed to delete expense. Please try again.');
    }
    void fetchExpenses();
  }

  const columns: ListingColumn<ExpenseRow>[] = [
    {
      key: 'date',
      label: t('colDate'),
      render: (r) => <span className="text-sm">{r.date}</span>,
    },
    {
      key: 'title',
      label: t('colExpense'),
      render: (r) => (
        <div>
          <div className="font-medium">{r.title}</div>
          {r.description && (
            <div className="text-xs text-muted-foreground line-clamp-1">{r.description}</div>
          )}
        </div>
      ),
    },
    {
      key: 'category',
      label: t('colCategory'),
      render: (r) => r.category
        ? <Badge variant="outline">{r.category}</Badge>
        : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'program',
      label: t('colProgram'),
      render: (r) => {
        if (!r.programId) return <span className="text-muted-foreground">—</span>;
        const title = programs.find((p) => p.id === r.programId)?.title;
        return <Badge variant="info" className="max-w-[12rem] truncate">{title ?? t('deletedProgram')}</Badge>;
      },
    },
    {
      key: 'amount',
      label: t('colAmount'),
      align: 'end',
      render: (r) => (
        <span className="font-medium text-destructive">
          -{formatCurrency(r.amount, locale)}
        </span>
      ),
    },
  ];

  const headerSlot = (
    <div className="flex items-center gap-2">
      <CsvImportDialog
        endpoint="/api/incubator/expenses/import"
        fields={CSV_FIELDS}
        description="Columns: Date (YYYY-MM-DD), Title, Description, Amount, Category"
        onImported={() => void fetchExpenses()}
      />
      <CreateExpenseDialog onCreated={() => void fetchExpenses()} programs={programs} />
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
                <Label htmlFor="eexp-date">{t('labelDate')}</Label>
                <Input id="eexp-date" type="date" className="mt-1" value={editDate}
                  onChange={(e) => setEditDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="eexp-amt">{t('labelAmount')}</Label>
                <Input id="eexp-amt" type="number" min="1" className="mt-1" value={editAmt}
                  onChange={(e) => setEditAmt(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="eexp-title">{t('labelTitle')}</Label>
              <Input id="eexp-title" className="mt-1" value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="eexp-cat">{t('labelCategory')}</Label>
              <CategoryField
                id="eexp-cat"
                value={editCatSel}
                otherValue={editCatOther}
                onChange={setEditCatSel}
                onOtherChange={setEditCatOther}
              />
            </div>
            {programs.length > 0 && (
              <div>
                <Label htmlFor="eexp-program">{t('labelProgram')}</Label>
                <ProgramField id="eexp-program" value={editProgram} onChange={setEditProgram} programs={programs} />
              </div>
            )}
            <div>
              <Label htmlFor="eexp-desc">{t('labelDescription')}</Label>
              <textarea
                id="eexp-desc"
                className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={editDesc} onChange={(e) => setEditDesc(e.target.value)} maxLength={1000}
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
        emptyIcon={<ArrowDownCircle className="size-5 text-muted-foreground" />}
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
