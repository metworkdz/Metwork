'use client';

/**
 * "Add participant" — record someone who signed up AT THE DESK.
 *
 * Deliberately shaped like the transaction it records, not like the database
 * rows behind it: who she is, the same questions the public form asks, what
 * she owes, and what she just handed over. The balance is computed in front of
 * the host as they type, because the number they read here is the number they
 * will say out loud to the person standing at the counter.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserPlus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { questionLabel, questionOptions } from '@/lib/registration-question';
import type { RegistrationFormField } from '@/types/domain';

interface Props {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  formFields: RegistrationFormField[];
  /** The listing's cash price, prefilled as the total. */
  defaultAmount: number;
  /** Which API owns this listing. */
  endpoint: '/api/incubator/registrations' | '/api/consultant/registrations';
  onAdded: () => void;
}

interface Form {
  fullName: string;
  email: string;
  phone: string;
  totalAmount: string;
  depositPaid: string;
  answers: Record<string, string | string[]>;
}

const blank = (defaultAmount: number): Form => ({
  fullName: '',
  email: '',
  phone: '',
  totalAmount: String(defaultAmount),
  depositPaid: '',
  answers: {},
});

export function AddParticipantDialog({
  entityType,
  entityId,
  formFields,
  defaultAmount,
  endpoint,
  onAdded,
}: Props) {
  const t = useTranslations('registrationsTable.addParticipant');
  const tq = useTranslations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => blank(defaultAmount));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Math.max(0, Math.round(Number(form.totalAmount) || 0));
  const deposit = Math.min(Math.max(0, Math.round(Number(form.depositPaid) || 0)), total);
  const due = total - deposit;

  const fields = useMemo(
    () => [...formFields].sort((a, b) => a.order - b.order),
    [formFields],
  );

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setAnswer = (fieldId: string, value: string | string[]) =>
    setForm((f) => ({ ...f, answers: { ...f.answers, [fieldId]: value } }));

  const dzd = (n: number) => `${n.toLocaleString('fr-DZ')} DZD`;

  function reset() {
    setForm(blank(defaultAmount));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType,
          entityId,
          fullName: form.fullName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          totalAmount: total,
          depositPaid: deposit,
          answers: Object.entries(form.answers)
            .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ''))
            .map(([fieldId, value]) => ({ fieldId, value })),
        }),
      });
      if (!res.ok) {
        // The error envelope is `{ error: { code, message } }` — reading the
        // top level here would silently show "undefined" to the host.
        const body = await res.json().catch(() => null);
        const code = body?.error?.code as string | undefined;
        if (code === 'MISSING_REQUIRED_FIELD') {
          // The server's message is English by design — it is an API, not a UI.
          // Name the question in the host's own language instead, resolving the
          // label the same way the form above renders it.
          const missingId = body?.error?.details?.fieldId as string | undefined;
          const missing = fields.find((f) => f.id === missingId);
          setError(
            missing
              ? t('errorRequiredField', { field: questionLabel(missing, tq) })
              : t('errorGeneric'),
          );
          return;
        }
        setError(
          code === 'ALREADY_REGISTERED' ? t('errorDuplicate')
          : code === 'FULL' ? t('errorFull')
          : t('errorGeneric'),
        );
        return;
      }
      setOpen(false);
      reset();
      onAdded();
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => { reset(); setOpen(true); }}>
        <UserPlus className="size-4" /> {t('cta')}
      </Button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-muted-foreground">{t('hint')}</p>

            <div className="space-y-1.5">
              <Label htmlFor="ap-name">{t('labelName')} *</Label>
              <Input id="ap-name" required value={form.fullName}
                onChange={(e) => set('fullName', e.target.value)} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-email">{t('labelEmail')} *</Label>
                <Input id="ap-email" type="email" required value={form.email}
                  onChange={(e) => set('email', e.target.value)} />
                <p className="text-[11px] text-muted-foreground">{t('emailHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-phone">{t('labelPhone')} *</Label>
                <Input id="ap-phone" required placeholder="+213…" value={form.phone}
                  onChange={(e) => set('phone', e.target.value)} />
              </div>
            </div>

            {/* The same questions the public form asks, so a desk sale does not
                produce a thinner record than an online one. */}
            {fields.map((field) => {
              const label = questionLabel(field, tq);
              const options = questionOptions(field, tq);
              const value = form.answers[field.id];
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label htmlFor={`ap-${field.id}`}>
                    {label}{field.required ? ' *' : ''}
                  </Label>
                  {field.type === 'LONG_TEXT' ? (
                    <Textarea id={`ap-${field.id}`} rows={3}
                      value={(value as string) ?? ''}
                      onChange={(e) => setAnswer(field.id, e.target.value)} />
                  ) : field.type === 'CHECKBOX' && options && options.length > 0 ? (
                    /* CHECKBOX is multi-answer on the public form and is stored
                       as an ARRAY. A single-value control here would record a
                       different shape for the same question depending on who
                       filled it in, and the CSV export would disagree with
                       itself halfway down the column. */
                    <div className="flex flex-col gap-2">
                      {options.map((o) => {
                        const picked = Array.isArray(value) ? value : [];
                        return (
                          <label key={o}
                            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm">
                            <input type="checkbox" className="size-4 accent-primary"
                              checked={picked.includes(o)}
                              onChange={() => setAnswer(
                                field.id,
                                picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o],
                              )} />
                            {o}
                          </label>
                        );
                      })}
                    </div>
                  ) : options && options.length > 0 ? (
                    <Select value={(value as string) ?? ''}
                      onValueChange={(v) => setAnswer(field.id, v)}>
                      <SelectTrigger id={`ap-${field.id}`}>
                        <SelectValue placeholder={t('selectPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input id={`ap-${field.id}`}
                      type={field.type === 'EMAIL' ? 'email' : field.type === 'URL' ? 'url' : 'text'}
                      value={(value as string) ?? ''}
                      onChange={(e) => setAnswer(field.id, e.target.value)} />
                  )}
                </div>
              );
            })}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ap-total">{t('labelTotal')}</Label>
                <Input id="ap-total" type="number" min={0} inputMode="numeric"
                  value={form.totalAmount}
                  onChange={(e) => set('totalAmount', e.target.value)} />
                <p className="text-[11px] text-muted-foreground">{t('totalHint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ap-deposit">{t('labelDeposit')}</Label>
                <Input id="ap-deposit" type="number" min={0} inputMode="numeric"
                  placeholder="0" value={form.depositPaid}
                  onChange={(e) => set('depositPaid', e.target.value)} />
                <p className="text-[11px] text-muted-foreground">{t('depositHint')}</p>
              </div>
            </div>

            {/* The number the host reads out loud. */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t('summaryPaid')}</span>
                <span className="font-semibold">{dzd(deposit)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">{t('summaryDue')}</span>
                <span className={due > 0 ? 'font-semibold text-amber-600' : 'font-semibold text-primary'}>
                  {dzd(due)}
                </span>
              </div>
            </div>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={saving} className="gap-1.5">
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('submit')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
