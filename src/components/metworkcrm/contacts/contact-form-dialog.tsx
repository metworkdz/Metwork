'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CrmButton } from '@/components/metworkcrm/ui/button';
import { EntityPicker } from '@/components/metworkcrm/shared/entity-picker';
import { CONTACT_LANGUAGE_LABELS, RECORD_STATUS_LABELS } from '@/components/metworkcrm/shared/labels';

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string;
  /**
   * `crm_contacts.full_name` is a STORED GENERATED column — drizzle types
   * generated columns as nullable even though it's computed from two NOT NULL
   * columns and is never actually null. Kept honest here; render sites fall
   * back to `firstName + lastName`.
   */
  fullName: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedinUrl: string | null;
  city: string | null;
  language: string | null;
  status: string;
  notes: string | null;
}

const selectClass =
  'h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-[var(--crm-green)] focus:ring-2 focus:ring-[var(--crm-green)]/20';

export function ContactFormDialog({
  trigger,
  contact,
  /** Create mode only: pre-select this organization as the new contact's primary. */
  presetOrganization,
  onSaved,
}: {
  trigger: React.ReactNode;
  /** Present → edit mode. Absent → create mode. */
  contact?: ContactRow;
  presetOrganization?: { id: string; label: string };
  onSaved: (id: string) => void;
}) {
  const isEdit = !!contact;
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState(contact?.firstName ?? '');
  const [lastName, setLastName] = useState(contact?.lastName ?? '');
  const [position, setPosition] = useState(contact?.position ?? '');
  const [email, setEmail] = useState(contact?.email ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(contact?.linkedinUrl ?? '');
  const [city, setCity] = useState(contact?.city ?? '');
  const [language, setLanguage] = useState(contact?.language ?? '');
  const [status, setStatus] = useState(contact?.status ?? 'ACTIF');
  const [notes, setNotes] = useState(contact?.notes ?? '');
  const [primaryOrg, setPrimaryOrg] = useState<{ id: string; label: string } | null>(
    presetOrganization ?? null,
  );

  // Re-seed every field from the CURRENT `contact` prop each time the dialog
  // opens — same staleness bug and fix as OrganizationFormDialog (see its
  // comment): a mounted-once dialog's useState initializers don't re-run when
  // the prop changes later (e.g. after "Archiver" updates the contact).
  useEffect(() => {
    if (!open) return;
    setError(null);
    setFirstName(contact?.firstName ?? '');
    setLastName(contact?.lastName ?? '');
    setPosition(contact?.position ?? '');
    setEmail(contact?.email ?? '');
    setPhone(contact?.phone ?? '');
    setWhatsapp(contact?.whatsapp ?? '');
    setLinkedinUrl(contact?.linkedinUrl ?? '');
    setCity(contact?.city ?? '');
    setLanguage(contact?.language ?? '');
    setStatus(contact?.status ?? 'ACTIF');
    setNotes(contact?.notes ?? '');
    setPrimaryOrg(presetOrganization ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      position: position || undefined,
      email: email || undefined,
      phone: phone || undefined,
      whatsapp: whatsapp || undefined,
      linkedinUrl: linkedinUrl || undefined,
      city: city || undefined,
      language: language || undefined,
      status,
      notes: notes || undefined,
    };
    // Only sent at creation — editing the org set happens via the dedicated
    // linking editor on the detail page, which always has the full picture.
    if (!isEdit && primaryOrg) {
      payload.organizations = [{ organizationId: primaryOrg.id, isPrimary: true }];
    }

    let res: Response;
    try {
      res = await fetch(isEdit ? `/api/metworkcrm/contacts/${contact!.id}` : '/api/metworkcrm/contacts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
      setSaving(false);
      return;
    }

    let data: { id?: string; contact?: { id: string }; error?: { message?: string } };
    try {
      data = await res.json();
    } catch {
      setError(`Réponse du serveur invalide (code ${res.status}). Réessayez ou contactez l'équipe technique.`);
      setSaving(false);
      return;
    }

    if (!res.ok) {
      setError(data?.error?.message ?? 'Une erreur est survenue.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    // create returns { contact, ... } (getContactDetail shape); update does too.
    onSaved(data.contact?.id ?? data.id!);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Modifier le contact' : 'Nouveau contact'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Prénom" htmlFor="ct-first" required>
              <Input id="ct-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
            </FormField>
            <FormField label="Nom" htmlFor="ct-last" required>
              <Input id="ct-last" value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={100} />
            </FormField>
          </div>

          <FormField label="Poste" htmlFor="ct-position">
            <Input id="ct-position" value={position} onChange={(e) => setPosition(e.target.value)} />
          </FormField>

          {!isEdit ? (
            <FormField label="Organisation principale" htmlFor="ct-org">
              <EntityPicker kind="organization" value={primaryOrg} onChange={setPrimaryOrg} />
            </FormField>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <FormField label="E-mail" htmlFor="ct-email">
              <Input id="ct-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Téléphone" htmlFor="ct-phone">
              <Input id="ct-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="WhatsApp" htmlFor="ct-whatsapp">
              <Input id="ct-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </FormField>
            <FormField label="LinkedIn" htmlFor="ct-linkedin">
              <Input id="ct-linkedin" type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://…" />
            </FormField>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FormField label="Ville" htmlFor="ct-city" className="col-span-1">
              <Input id="ct-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </FormField>
            <FormField label="Langue" htmlFor="ct-lang" className="col-span-1">
              <select id="ct-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={selectClass}>
                <option value="">—</option>
                {Object.entries(CONTACT_LANGUAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Statut" htmlFor="ct-status" className="col-span-1" required>
              <select id="ct-status" value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
                {Object.entries(RECORD_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </FormField>
          </div>

          <FormField label="Notes internes" htmlFor="ct-notes">
            <Textarea id="ct-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </FormField>

          {error ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <CrmButton type="button" variant="outline" onClick={() => setOpen(false)}>
              Annuler
            </CrmButton>
            <CrmButton type="submit" loading={saving}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </CrmButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
