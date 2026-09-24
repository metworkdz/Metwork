'use client';

/**
 * Add or edit one expense of a program — the room, the trainer, the coffee
 * breaks — with an optional photo of the receipt.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ProgramExpense {
  id: string;
  date: string;
  title: string;
  description: string | null;
  amount: number;
  category: string | null;
  receiptUrl?: string | null;
}

interface Props {
  /** null = closed; 'new' = adding; an expense = editing it. */
  target: ProgramExpense | 'new' | null;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
  uploadEndpoint: string;
  uploadKind?: string;
  onSaved: () => void;
}

const CATEGORY_KEYS = ['catRoom', 'catTrainer', 'catCatering', 'catMaterial', 'catMarketing', 'catTravel', 'catPrinting', 'catOther'] as const;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as
    { error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } } | null;
  const field = body?.error?.details?.fieldErrors;
  return (field ? Object.values(field).flat()[0] : undefined) ?? body?.error?.message ?? fallback;
}

/** Today in Algiers, as the date input wants it. */
function today(): string {
  return new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
}

export function ProgramExpenseDialog({ target, onOpenChange, endpoint, uploadEndpoint, uploadKind, onSaved }: Props) {
  const t = useTranslations('programFinance');
  const editing = target && target !== 'new' ? target : null;
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the row being edited, or a blank form, each time the dialog opens.
  useEffect(() => {
    if (!target) return;
    const e = target === 'new' ? null : target;
    setDate(e?.date ?? today());
    setAmount(e ? String(e.amount) : '');
    setTitle(e?.title ?? '');
    setCategory(e?.category ?? '');
    setDescription(e?.description ?? '');
    setReceiptUrl(e?.receiptUrl ?? null);
    setError(null);
  }, [target]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (uploadKind) form.append('kind', uploadKind);
      const res = await fetch(uploadEndpoint, { method: 'POST', credentials: 'include', body: form });
      if (!res.ok) throw new Error(await errorMessage(res, t('uploadFailed')));
      setReceiptUrl((await res.json() as { url: string }).url);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('uploadFailed'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        date,
        title: title.trim(),
        amount: Number(amount),
        category: category.trim() || null,
        description: description.trim() || null,
        receiptUrl,
      };
      const res = await fetch(editing ? `${endpoint}/${editing.id}` : endpoint, {
        method: editing ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('saveFailed')));
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editExpense') : t('addExpense')}</DialogTitle>
          <DialogDescription>{t('expenseDialogHint')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void save(e)} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pfx-date">{t('labelDate')}</Label>
              <Input id="pfx-date" type="date" className="mt-1" value={date} required
                onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pfx-amount">{t('labelAmount')}</Label>
              <Input id="pfx-amount" type="number" inputMode="numeric" min={1} step={1} className="mt-1" required
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div>
            <Label htmlFor="pfx-title">{t('labelTitle')}</Label>
            <Input id="pfx-title" className="mt-1" required maxLength={200} value={title}
              placeholder={t('titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pfx-cat">{t('labelCategory')}</Label>
            <Input id="pfx-cat" className="mt-1" maxLength={80} value={category} list="pfx-cat-list"
              placeholder={t('categoryPlaceholder')} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="pfx-cat-list">
              {CATEGORY_KEYS.map((k) => <option key={k} value={t(k)} />)}
            </datalist>
          </div>
          <div>
            <Label htmlFor="pfx-desc">{t('labelDescription')}</Label>
            <textarea id="pfx-desc" rows={2} maxLength={1000} value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-base sm:text-sm" />
          </div>
          <div>
            <span className="text-sm font-medium">{t('labelReceipt')}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {receiptUrl ? (
                <>
                  <a href={receiptUrl} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                    <Paperclip className="size-3.5" /> {t('viewReceipt')}
                  </a>
                  <Button type="button" size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                    onClick={() => setReceiptUrl(null)}>
                    <Trash2 className="size-3.5" /> {t('removeReceipt')}
                  </Button>
                </>
              ) : (
                <Button type="button" size="sm" variant="outline" className="gap-1.5" loading={uploading}
                  onClick={() => fileRef.current?.click()}>
                  <Paperclip className="size-3.5" /> {t('attachReceipt')}
                </Button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={(e) => void upload(e.target.files?.[0])} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('receiptHint')}</p>
          </div>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
            <Button type="submit" loading={saving} disabled={uploading}>{editing ? t('save') : t('addExpense')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
