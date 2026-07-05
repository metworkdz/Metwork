'use client';

/**
 * Dialog for creating or editing a client record.
 * POST /api/incubator/clients  — create
 * PATCH /api/incubator/clients/:id — edit
 *
 * A client is either an "Entreprise" (COMPANY — invoiced with its legal
 * identifiers: raison sociale, RC, NIF, NIS, AI) or a "Personne physique"
 * (INDIVIDUAL). The toggle drives which billing fields are shown; both keep
 * the base contact fields used across the CRM, manual bookings and invoices.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, PlusCircle, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type ClientType = 'COMPANY' | 'INDIVIDUAL';

interface ClientValues {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
  /** Billing profile — optional so legacy callers keep compiling. */
  clientType?: ClientType;
  legalName?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  nis?: string | null;
  ai?: string | null;
}

/** Shape of the client record returned by POST /api/incubator/clients. */
export interface CreatedClient {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  idCardNumber: string | null;
  companyName: string | null;
  notes: string | null;
  clientType?: ClientType;
  legalName?: string | null;
  address?: string | null;
  rc?: string | null;
  nif?: string | null;
  nis?: string | null;
  ai?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ClientFormDialogProps {
  /** Pass an existing client to edit. Omit (or undefined) for create mode. */
  client?: ClientValues;
  /** Shown instead of the default trigger button (create mode only). */
  trigger?: React.ReactNode;
  onSaved: () => void;
  /**
   * Optional: receive the created client record (create mode). Lets a caller
   * auto-select the new client without a second round-trip. Fires in addition
   * to `onSaved`.
   */
  onCreated?: (client: CreatedClient) => void;
  /**
   * Optional controlled open state. When provided the dialog renders no
   * trigger (the caller opens it). Omitted → self-managed with its trigger.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ClientFormDialog({
  client,
  trigger,
  onSaved,
  onCreated,
  open: controlledOpen,
  onOpenChange,
}: ClientFormDialogProps) {
  const t = useTranslations('incubator.clientForm');
  const isEdit = Boolean(client);
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (v: boolean) => {
    if (!isControlled) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [clientType, setClientType] = useState<ClientType>('COMPANY');
  const [fullName, setFullName] = useState('');
  const [email, setEmail]       = useState('');
  const [phone, setPhone]       = useState('');
  const [idCard, setIdCard]     = useState('');
  const [notes, setNotes]       = useState('');
  const [legalName, setLegalName] = useState('');
  const [address, setAddress]     = useState('');
  const [rc, setRc]   = useState('');
  const [nif, setNif] = useState('');
  const [nis, setNis] = useState('');
  const [ai, setAi]   = useState('');

  const isCompany = clientType === 'COMPANY';

  // Populate form when editing
  useEffect(() => {
    if (open && client) {
      setClientType(client.clientType ?? (client.companyName ? 'COMPANY' : 'INDIVIDUAL'));
      setFullName(client.fullName);
      setEmail(client.email ?? '');
      setPhone(client.phone ?? '');
      setIdCard(client.idCardNumber ?? '');
      setNotes(client.notes ?? '');
      setLegalName(client.legalName ?? client.companyName ?? '');
      setAddress(client.address ?? '');
      setRc(client.rc ?? '');
      setNif(client.nif ?? '');
      setNis(client.nis ?? '');
      setAi(client.ai ?? '');
    }
  }, [open, client]);

  function reset() {
    setClientType('COMPANY');
    setFullName(''); setEmail(''); setPhone('');
    setIdCard(''); setNotes('');
    setLegalName(''); setAddress('');
    setRc(''); setNif(''); setNis(''); setAi('');
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const url    = isEdit ? `/api/incubator/clients/${client!.id}` : '/api/incubator/clients';
      const method = isEdit ? 'PATCH' : 'POST';
      // For a COMPANY, keep companyName in sync with the legal name so every
      // legacy surface (manual bookings, CRM list) keeps displaying it.
      const trimmedLegal = legalName.trim();
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName:     fullName.trim(),
          email:        email.trim() || undefined,
          phone:        phone.trim() || undefined,
          idCardNumber: idCard.trim() || null,
          companyName:  isCompany ? (trimmedLegal || null) : null,
          notes:        notes.trim() || null,
          clientType,
          legalName:    isCompany ? (trimmedLegal || null) : null,
          address:      address.trim() || null,
          rc:           isCompany ? (rc.trim() || null) : null,
          nif:          isCompany ? (nif.trim() || null) : null,
          nis:          isCompany ? (nis.trim() || null) : null,
          ai:           isCompany ? (ai.trim() || null) : null,
        }),
      });
      if (!res.ok) {
        // API error envelope: { error: { code, message, details: { fieldErrors } } }
        const d = await res.json().catch(() => ({})) as {
          error?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } };
        };
        const fieldReason = Object.values(d.error?.details?.fieldErrors ?? {})
          .flat()
          .find(Boolean);
        setError(fieldReason ?? d.error?.message ?? t('errorSave'));
        return;
      }
      // Surface the created record so a caller can auto-select it (create only).
      if (onCreated && !isEdit) {
        const record = await res.json().catch(() => null) as CreatedClient | null;
        if (record) onCreated(record);
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
      {!isControlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" className="gap-1.5">
              <PlusCircle className="size-4" />
              {t('addClient')}
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('titleEdit') : t('titleNew')}</DialogTitle>
          <DialogDescription>
            {isEdit ? t('descriptionEdit') : t('descriptionNew')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-2">
          {/* ── Entreprise | Personne physique ── */}
          <div className="grid grid-cols-2 gap-1.5 rounded-lg border border-border bg-muted/40 p-1.5">
            {(['COMPANY', 'INDIVIDUAL'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setClientType(type)}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  clientType === type
                    ? 'bg-background text-primary shadow-sm border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {type === 'COMPANY'
                  ? <Building2 className="size-4" />
                  : <UserRound className="size-4" />}
                {type === 'COMPANY' ? t('typeCompany') : t('typeIndividual')}
              </button>
            ))}
          </div>

          {/* ── Identity ── */}
          {isCompany && (
            <div>
              <Label htmlFor="c-legal">{t('labelLegalName')}</Label>
              <Input
                id="c-legal"
                className="mt-1"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                required
                maxLength={200}
                placeholder={t('legalNamePlaceholder')}
              />
            </div>
          )}

          <div>
            <Label htmlFor="c-name">{isCompany ? t('labelContactName') : t('labelFullName')}</Label>
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

          <div>
            <Label htmlFor="c-address">{t('labelAddress')}</Label>
            <Input
              id="c-address"
              className="mt-1"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              maxLength={500}
              placeholder={t('optional')}
            />
          </div>

          {/* ── Legal identifiers (Entreprise) ── */}
          {isCompany && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('sectionLegalIds')}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="c-rc">{t('labelRc')}</Label>
                  <Input id="c-rc" className="mt-1" value={rc}
                    onChange={(e) => setRc(e.target.value)} maxLength={100}
                    placeholder={t('optional')} />
                </div>
                <div>
                  <Label htmlFor="c-nif">{t('labelNif')}</Label>
                  <Input id="c-nif" className="mt-1" value={nif}
                    onChange={(e) => setNif(e.target.value)} maxLength={100}
                    placeholder={t('optional')} />
                </div>
                <div>
                  <Label htmlFor="c-nis">{t('labelNis')}</Label>
                  <Input id="c-nis" className="mt-1" value={nis}
                    onChange={(e) => setNis(e.target.value)} maxLength={100}
                    placeholder={t('optional')} />
                </div>
                <div>
                  <Label htmlFor="c-ai">{t('labelAi')}</Label>
                  <Input id="c-ai" className="mt-1" value={ai}
                    onChange={(e) => setAi(e.target.value)} maxLength={100}
                    placeholder={t('optional')} />
                </div>
              </div>
            </div>
          )}

          {/* ── Contact ── */}
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

          {!isCompany && (
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
          )}

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
