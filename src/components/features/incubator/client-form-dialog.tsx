'use client';

/**
 * Dialog for creating or editing a client record.
 * POST /api/incubator/clients  — create
 * PATCH /api/incubator/clients/:id — edit
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { PlusCircle } from 'lucide-react';
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

interface ClientValues {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
}

interface ClientFormDialogProps {
  /** Pass an existing client to edit. Omit (or undefined) for create mode. */
  client?: ClientValues;
  /** Shown instead of the default trigger button (create mode only). */
  trigger?: React.ReactNode;
  onSaved: () => void;
}

export function ClientFormDialog({ client, trigger, onSaved }: ClientFormDialogProps) {
  const t = useTranslations('incubator.clientForm');
  const isEdit = Boolean(client);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [idCard, setIdCard]     = useState('');
  const [company, setCompany]   = useState('');
  const [notes, setNotes]       = useState('');

  // Populate form when editing
  useEffect(() => {
    if (open && client) {
      setFullName(client.fullName);
      setEmail(client.email ?? '');
      setPhone(client.phone ?? '');
      setIdCard(client.idCardNumber ?? '');
      setCompany(client.companyName ?? '');
      setNotes(client.notes ?? '');
    }
  }, [open, client]);

  function reset() {
    setFullName(''); setEmail(''); setPhone('');
    setIdCard(''); setCompany(''); setNotes('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url    = isEdit ? `/api/incubator/clients/${client!.id}` : '/api/incubator/clients';
      const method = isEdit ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:     fullName.trim(),
          email:        email.trim() || undefined,
          phone:        phone.trim() || undefined,
          idCardNumber: idCard.trim() || null,
          companyName:  company.trim() || null,
          notes:        notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { message?: string };
        setError(d.message ?? t('errorSave'));
        return;
      }
      onSaved();
      setOpen(false);
      if (!isEdit) reset();
    } catch {
      setError(t('errorNetwork'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v && !isEdit) reset(); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" className="gap-1.5">
            <PlusCircle className="size-4" />
            {t('addClient')}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('descriptionEdit') : t('descriptionNew')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 py-2">
          <div>
            <Label htmlFor="c-name">{t('labelFullName')}</Label>
            <Input
              id="c-name"
              className="mt-1"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              minLength={2}
              maxLength={120}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-email">{t('labelEmail')}</Label>
              <Input
                id="c-email"
                type="email"
                className="mt-1"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('optional')}
              />
            </div>
            <div>
              <Label htmlFor="c-phone">{t('labelPhone')}</Label>
              <Input
                id="c-phone"
                type="tel"
                className="mt-1"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('optional')}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="c-id">{t('labelIdCard')}</Label>
              <Input
                id="c-id"
                className="mt-1"
                value={idCard}
                onChange={(e) => setIdCard(e.target.value)}
                placeholder={t('optional')}
              />
            </div>
            <div>
              <Label htmlFor="c-company">{t('labelCompany')}</Label>
              <Input
                id="c-company"
                className="mt-1"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t('optional')}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="c-notes">{t('labelNotes')}</Label>
            <textarea
              id="c-notes"
              className="mt-1 min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              placeholder={t('notesPlaceholder')}
            />
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" loading={submitting}>
              {isEdit ? t('saveChanges') : t('createClient')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
